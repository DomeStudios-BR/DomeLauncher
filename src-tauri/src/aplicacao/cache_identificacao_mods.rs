use super::*;
use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;

const DIA: u64 = 24 * 60 * 60;
static RESERVAS: OnceLock<Vec<Semaphore>> = OnceLock::new();

#[cfg(test)]
#[path = "testes_cache_identificacao_mods.rs"]
mod testes;

#[derive(Clone, Deserialize, Serialize, PartialEq)]
struct EstadoArquivo {
    tamanho: u64,
    modificado: Option<u64>,
    criado: Option<u64>,
}

impl EstadoArquivo {
    fn ler(caminho: &Path) -> Result<Self, String> {
        let dados =
            std::fs::metadata(caminho).map_err(|erro| format!("Erro ao conferir mod: {erro}"))?;
        let nanos = |data: std::io::Result<SystemTime>| {
            u64::try_from(data.ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos()).ok()
        };
        Ok(Self {
            tamanho: dados.len(),
            modificado: nanos(dados.modified()),
            criado: nanos(dados.created()),
        })
    }
}

#[derive(Deserialize, Serialize)]
struct ArquivoCache {
    estado: EstadoArquivo,
    sha512: String,
}

#[derive(Deserialize, Serialize)]
struct IdentificacaoCache {
    item: ModIdentificado,
    consultado_em: u64,
}

impl IdentificacaoCache {
    fn valido(&self, agora: u64) -> bool {
        if self.item.project_id.is_some() {
            return true;
        }
        agora
            .checked_sub(self.consultado_em)
            .is_some_and(|idade| idade < DIA)
    }
}

#[derive(Default, Deserialize, Serialize)]
pub(super) struct CacheIdentificacao {
    arquivos: HashMap<String, ArquivoCache>,
    identificacoes: HashMap<String, IdentificacaoCache>,
}

pub(super) struct Preparacao {
    pub assinaturas: Vec<AssinaturaMod>,
    cache: CacheIdentificacao,
    alterado: bool,
    #[cfg(test)]
    arquivos_lidos: usize,
}

pub(super) fn preparar(
    instancia: &Path,
    mut cache: CacheIdentificacao,
) -> Result<Preparacao, String> {
    let mut preparacao = Preparacao {
        assinaturas: Vec::new(),
        cache: CacheIdentificacao::default(),
        alterado: false,
        #[cfg(test)]
        arquivos_lidos: 0,
    };
    let pasta = instancia.join("mods");
    if !pasta.exists() {
        preparacao.alterado = !cache.arquivos.is_empty();
        cache.arquivos.clear();
        preparacao.cache = cache;
        return Ok(preparacao);
    }
    let pasta = validar_caminho_dentro_raiz(instancia, &pasta)?;
    let entradas =
        std::fs::read_dir(&pasta).map_err(|erro| format!("Erro ao listar mods: {erro}"))?;
    let mut presentes = HashSet::new();
    for entrada in entradas {
        let entrada = entrada.map_err(|erro| format!("Erro ao ler pasta de mods: {erro}"))?;
        let nome = entrada.file_name().to_string_lossy().into_owned();
        let minusculo = nome.to_lowercase();
        if !(minusculo.ends_with(".jar") || minusculo.ends_with(".jar.disabled")) {
            continue;
        }
        let caminho = validar_caminho_dentro_raiz(&pasta, &entrada.path())?;
        if !caminho.is_file() {
            continue;
        }
        let chave = nome.clone();
        let alternativo = if minusculo.ends_with(".disabled") {
            nome[..nome.len() - ".disabled".len()].to_string()
        } else {
            format!("{nome}.disabled")
        };
        let estado = EstadoArquivo::ler(&caminho)?;
        let sha512 = match cache
            .arquivos
            .get(&chave)
            .or_else(|| {
                (!pasta.join(&alternativo).exists())
                    .then(|| cache.arquivos.get(&alternativo))
                    .flatten()
            })
            .filter(|item| estado.modificado.is_some() && item.estado == estado)
        {
            Some(item) => {
                let hash = item.sha512.clone();
                if !cache.arquivos.contains_key(&chave) {
                    cache.arquivos.insert(
                        chave.clone(),
                        ArquivoCache {
                            estado,
                            sha512: hash.clone(),
                        },
                    );
                    preparacao.alterado = true;
                }
                hash
            }
            None => {
                let bytes = std::fs::read(&caminho)
                    .map_err(|erro| format!("Erro ao ler {nome}: {erro}"))?;
                if EstadoArquivo::ler(&caminho)? != estado {
                    return Err(format!(
                        "O arquivo {nome} mudou durante a identificação. Tente novamente."
                    ));
                }
                let hash = format!("{:x}", Sha512::digest(&bytes));
                cache.arquivos.insert(
                    chave.clone(),
                    ArquivoCache {
                        estado,
                        sha512: hash.clone(),
                    },
                );
                preparacao.alterado = true;
                #[cfg(test)]
                {
                    preparacao.arquivos_lidos += 1;
                }
                hash
            }
        };
        presentes.insert(chave);
        preparacao.assinaturas.push(AssinaturaMod {
            nome,
            sha512,
            fingerprint: None,
            caminho: Some(caminho),
        });
    }
    let anterior = cache.arquivos.len();
    cache.arquivos.retain(|nome, _| presentes.contains(nome));
    preparacao.alterado |= anterior != cache.arquivos.len();
    preparacao.cache = cache;
    Ok(preparacao)
}

fn agora() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(super) async fn identificar_com_cache(
    cliente: &reqwest::Client,
    instancia: &Path,
    base_modrinth: &str,
    base_curseforge: &str,
) -> Result<ResultadoIdentificacao, String> {
    let arquivo_cache = caminho_cache(instancia);
    identificar_no_arquivo(
        cliente,
        instancia,
        &arquivo_cache,
        base_modrinth,
        base_curseforge,
    )
    .await
}

fn caminho_cache(instancia: &Path) -> PathBuf {
    let chave = format!(
        "{:x}",
        sha2::Sha256::digest(instancia.to_string_lossy().as_bytes())
    );
    crate::launcher::pasta_dados_launcher()
        .join("cache/mods-identificados-v1")
        .join(format!("{chave}.json"))
}

/// Restaure os vínculos na leitura local da lista, sem depender da rede nem do armazenamento da interface.
pub(in crate::aplicacao) fn restaurar_identificacoes(
    instancia: &Path,
    nomes: &[String],
) -> HashMap<String, ModIdentificado> {
    let Ok(instancia) = instancia.canonicalize() else {
        return HashMap::new();
    };
    restaurar_no_arquivo(&instancia, &caminho_cache(&instancia), nomes)
}

fn restaurar_no_arquivo(
    instancia: &Path,
    arquivo: &Path,
    nomes: &[String],
) -> HashMap<String, ModIdentificado> {
    let Some(cache) = std::fs::read(arquivo)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CacheIdentificacao>(&bytes).ok())
    else {
        return HashMap::new();
    };
    let Ok(pasta) = validar_caminho_dentro_raiz(instancia, &instancia.join("mods")) else {
        return HashMap::new();
    };
    nomes
        .iter()
        .filter_map(|nome| {
            let registro = cache.arquivos.get(nome)?;
            let caminho = validar_caminho_dentro_raiz(&pasta, &pasta.join(nome)).ok()?;
            let estado = EstadoArquivo::ler(&caminho).ok()?;
            if estado.modificado.is_none() || estado != registro.estado {
                return None;
            }
            let mut item = cache.identificacoes.get(&registro.sha512)?.item.clone();
            item.project_id.as_ref()?;
            item.file_name = nome.clone();
            Some((nome.clone(), item))
        })
        .collect()
}

async fn identificar_no_arquivo(
    cliente: &reqwest::Client,
    instancia: &Path,
    arquivo_cache: &Path,
    base_modrinth: &str,
    base_curseforge: &str,
) -> Result<ResultadoIdentificacao, String> {
    let reservas = RESERVAS.get_or_init(|| (0..256).map(|_| Semaphore::new(1)).collect());
    let indice = sha2::Sha256::digest(arquivo_cache.to_string_lossy().as_bytes())[0] as usize;
    let _reserva = reservas[indice]
        .acquire()
        .await
        .map_err(|erro| erro.to_string())?;
    let instancia = instancia.to_path_buf();
    let arquivo = arquivo_cache.to_path_buf();
    let mut preparacao = tauri::async_runtime::spawn_blocking(move || {
        let cache = std::fs::read(arquivo)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        preparar(&instancia, cache)
    })
    .await
    .map_err(|erro| format!("Falha ao conferir mods: {erro}"))??;
    let mut resultado = ResultadoIdentificacao::default();
    let instante = agora();
    let mut pendentes = Vec::new();
    for assinatura in &preparacao.assinaturas {
        match preparacao
            .cache
            .identificacoes
            .get(&assinatura.sha512)
            .filter(|item| item.valido(instante))
        {
            Some(registro) => {
                let mut item = registro.item.clone();
                item.file_name = assinatura.nome.clone();
                resultado.itens.push(item);
            }
            None => pendentes.push(assinatura.clone()),
        }
    }
    if !pendentes.is_empty() {
        let consultados =
            identificar_assinaturas(cliente, &pendentes, base_modrinth, base_curseforge).await?;
        let hashes = pendentes
            .iter()
            .map(|item| (&item.nome, &item.sha512))
            .collect::<HashMap<_, _>>();
        for item in &consultados.itens {
            if let Some(hash) = hashes.get(&item.file_name) {
                preparacao.cache.identificacoes.insert(
                    (*hash).clone(),
                    IdentificacaoCache {
                        item: item.clone(),
                        consultado_em: instante,
                    },
                );
                preparacao.alterado = true;
            }
        }
        resultado.itens.extend(consultados.itens);
        resultado.falhas = consultados.falhas;
    }
    if preparacao.alterado {
        let presentes = preparacao
            .assinaturas
            .iter()
            .map(|item| item.sha512.clone())
            .collect::<HashSet<_>>();
        preparacao
            .cache
            .identificacoes
            .retain(|hash, _| presentes.contains(hash));
        let arquivo = arquivo_cache.to_path_buf();
        let gravacao =
            tauri::async_runtime::spawn_blocking(move || salvar(&arquivo, &preparacao.cache)).await;
        if let Err(erro) = gravacao
            .map_err(|erro| erro.to_string())
            .and_then(|resultado| resultado)
        {
            resultado.falhas.push(erro);
        }
    }
    Ok(resultado)
}

fn salvar(arquivo: &Path, cache: &CacheIdentificacao) -> Result<(), String> {
    let pasta = arquivo.parent().ok_or("Cache sem diretório pai.")?;
    let temporario = pasta.join(format!("{}.part", uuid::Uuid::new_v4()));
    let gravar = || -> Result<(), String> {
        std::fs::create_dir_all(pasta).map_err(|erro| erro.to_string())?;
        let bytes = serde_json::to_vec(cache).map_err(|erro| erro.to_string())?;
        std::fs::write(&temporario, bytes).map_err(|erro| erro.to_string())?;
        std::fs::rename(&temporario, arquivo).map_err(|erro| erro.to_string())
    };
    let resultado = gravar();
    if resultado.is_err() {
        let _ = std::fs::remove_file(temporario);
    }
    resultado.map_err(|erro| format!("Não foi possível salvar a identificação dos mods: {erro}"))
}
