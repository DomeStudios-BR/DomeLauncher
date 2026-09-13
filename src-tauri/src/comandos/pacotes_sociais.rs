use crate::launcher::Instance;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256, Sha512};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

pub const LIMITE_PACOTE: u64 = 2 * 1024 * 1024 * 1024;
pub const LIMITE_EXTRAIDO: u64 = 8 * 1024 * 1024 * 1024;
const LIMITE_ENTRADAS: usize = 50_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArquivoSocial {
    pub caminho: String,
    pub tamanho_bytes: u64,
    pub configuracao: bool,
    pub sha256: String,
    #[serde(default)]
    pub sha512: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referencia: Option<ReferenciaModrinth>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenciaModrinth {
    pub versao_id: String,
    pub url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviaSocial {
    pub nome: String,
    pub versao_minecraft: String,
    pub loader: Option<String>,
    pub tamanho_bytes: u64,
    pub arquivos: Vec<ArquivoSocial>,
}

pub fn validar_nome(nome: &str) -> Result<(), String> {
    if nome.is_empty()
        || nome.contains(['\\', ':'])
        || Path::new(nome)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || nome.split('/').any(|p| {
            let base = p.split('.').next().unwrap_or_default().to_uppercase();
            p.is_empty()
                || p == "."
                || p == ".."
                || p.ends_with(['.', ' '])
                || [
                    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6",
                    "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
                    "LPT8", "LPT9",
                ]
                .contains(&base.as_str())
        })
    {
        return Err("Caminho inválido no pacote de instância.".into());
    }
    Ok(())
}

pub fn hash_arquivo(caminho: &Path) -> Result<String, String> {
    Ok(hashes_arquivo(caminho)?.0)
}

fn hashes_arquivo(caminho: &Path) -> Result<(String, String), String> {
    let mut arquivo = std::fs::File::open(caminho).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut hash512 = Sha512::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let tamanho = arquivo.read(&mut buffer).map_err(|e| e.to_string())?;
        if tamanho == 0 {
            break;
        }
        hash.update(&buffer[..tamanho]);
        hash512.update(&buffer[..tamanho]);
    }
    Ok((
        format!("{:x}", hash.finalize()),
        format!("{:x}", hash512.finalize()),
    ))
}

fn coletar(
    raiz: &Path,
    pasta: &Path,
    arquivos: &mut Vec<ArquivoSocial>,
    calcular_hashes: bool,
    selecionados: Option<&std::collections::HashSet<String>>,
) -> Result<(), String> {
    if !pasta.exists() {
        return Ok(());
    }
    if std::fs::symlink_metadata(pasta)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Remova links simbólicos do conteúdo compartilhado.".into());
    }
    for entrada in std::fs::read_dir(pasta).map_err(|e| e.to_string())? {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let tipo = entrada.file_type().map_err(|e| e.to_string())?;
        if tipo.is_symlink() {
            return Err("Links simbólicos não podem ser compartilhados.".into());
        }
        if tipo.is_dir() {
            coletar(
                raiz,
                &entrada.path(),
                arquivos,
                calcular_hashes,
                selecionados,
            )?;
        }
        if !tipo.is_file() {
            continue;
        }
        if arquivos.len() >= LIMITE_ENTRADAS {
            return Err("A instância contém arquivos demais.".into());
        }
        let caminho = entrada
            .path()
            .strip_prefix(raiz)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if ["instance.json", "dome_manifest.json"].contains(&caminho.as_str()) {
            continue;
        }
        if selecionados.is_some_and(|caminhos| !caminhos.contains(&caminho)) {
            continue;
        }
        validar_nome(&caminho)?;
        let (sha256, sha512) = if calcular_hashes {
            hashes_arquivo(&entrada.path())?
        } else {
            (String::new(), String::new())
        };
        arquivos.push(ArquivoSocial {
            configuracao: !["mods/", "resourcepacks/", "shaderpacks/"]
                .iter()
                .any(|p| caminho.starts_with(p)),
            tamanho_bytes: entrada.metadata().map_err(|e| e.to_string())?.len(),
            sha256,
            sha512,
            referencia: None,
            caminho,
        });
    }
    Ok(())
}

pub fn previa(instancia: &Instance) -> Result<PreviaSocial, String> {
    criar_previa(instancia, true, None)
}

pub fn previa_rapida(instancia: &Instance) -> Result<PreviaSocial, String> {
    criar_previa(instancia, false, None)
}

pub fn previa_selecionada(
    instancia: &Instance,
    caminhos: &[String],
) -> Result<PreviaSocial, String> {
    let selecionados = caminhos.iter().cloned().collect();
    criar_previa(instancia, true, Some(&selecionados))
}

fn criar_previa(
    instancia: &Instance,
    calcular_hashes: bool,
    selecionados: Option<&std::collections::HashSet<String>>,
) -> Result<PreviaSocial, String> {
    let mut arquivos = Vec::new();
    coletar(
        &instancia.path,
        &instancia.path,
        &mut arquivos,
        calcular_hashes,
        selecionados,
    )?;
    arquivos.sort_by(|a, b| a.caminho.cmp(&b.caminho));
    Ok(PreviaSocial {
        nome: instancia.name.clone(),
        versao_minecraft: instancia.version.clone(),
        loader: instancia.loader_type.clone(),
        tamanho_bytes: arquivos.iter().map(|a| a.tamanho_bytes).sum(),
        arquivos,
    })
}

pub struct Temporario(pub PathBuf);
impl Drop for Temporario {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub struct PastaTemporaria {
    caminho: PathBuf,
    raiz: PathBuf,
}
impl PastaTemporaria {
    pub fn nova(raiz: &Path, caminho: &Path) -> Result<Self, String> {
        let raiz = raiz.canonicalize().map_err(|e| e.to_string())?;
        let caminho = caminho.canonicalize().map_err(|e| e.to_string())?;
        if caminho == raiz || !caminho.starts_with(&raiz) {
            return Err("Pasta temporária inválida.".into());
        }
        Ok(Self { caminho, raiz })
    }
}
impl Drop for PastaTemporaria {
    fn drop(&mut self) {
        if let Ok(caminho) = self.caminho.canonicalize() {
            if caminho != self.raiz && caminho.starts_with(&self.raiz) {
                let _ = std::fs::remove_dir_all(caminho);
            }
        }
    }
}

#[cfg(test)]
pub fn exportar(
    instancia: &Instance,
    selecionados: Option<Vec<String>>,
    referencias: Vec<ArquivoSocial>,
) -> Result<PathBuf, String> {
    let mut previa = previa(instancia)?;
    for arquivo in &mut previa.arquivos {
        if let Some(conhecido) = referencias.iter().find(|referencia| {
            referencia.caminho == arquivo.caminho
                && referencia.sha256 == arquivo.sha256
                && referencia.sha512 == arquivo.sha512
                && !arquivo.configuracao
        }) {
            arquivo.referencia = conhecido.referencia.clone();
        }
    }
    Ok(exportar_previa(instancia, selecionados, previa)?.0)
}

pub fn exportar_previa(
    instancia: &Instance,
    selecionados: Option<Vec<String>>,
    mut previa: PreviaSocial,
) -> Result<(PathBuf, PreviaSocial), String> {
    let arquivos: Vec<_> = previa
        .arquivos
        .into_iter()
        .filter(|a| {
            selecionados
                .as_ref()
                .map_or(!a.configuracao, |caminhos| caminhos.contains(&a.caminho))
        })
        .collect();
    for arquivo in &arquivos {
        if let Some(referencia) = &arquivo.referencia {
            validar_url_modrinth(&referencia.url)?;
        }
    }
    if arquivos
        .iter()
        .filter(|a| a.referencia.is_none())
        .map(|a| a.tamanho_bytes)
        .sum::<u64>()
        > LIMITE_PACOTE
    {
        return Err("Conteúdo selecionado excede 2 GiB. Selecione menos arquivos.".into());
    }
    let pasta = std::env::temp_dir()
        .join("dome-social-sync")
        .join("outgoing");
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let caminho = pasta.join(format!("{}.dome", uuid::Uuid::new_v4()));
    let temporario = Temporario(caminho.clone());
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&caminho).map_err(|e| e.to_string())?);
    let opcoes = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let manifesto = serde_json::json!({
        "domeLauncherVersion": "2.0", "nome": instancia.name, "versaoMinecraft": instancia.version,
        "mcType": instancia.mc_type, "loaderType": instancia.loader_type,
        "loaderVersion": instancia.loader_version, "exportadoEm": chrono::Utc::now().to_rfc3339(),
        "icon": instancia.icon, "arquivos": arquivos
    });
    zip.start_file("dome_manifest.json", opcoes)
        .map_err(|e| e.to_string())?;
    zip.write_all(&serde_json::to_vec(&manifesto).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for arquivo in &arquivos {
        if arquivo.referencia.is_some() {
            continue;
        }
        let origem = instancia.path.join(&arquivo.caminho);
        zip.start_file(&arquivo.caminho, opcoes)
            .map_err(|e| e.to_string())?;
        std::io::copy(
            &mut std::fs::File::open(&origem).map_err(|e| e.to_string())?,
            &mut zip,
        )
        .map_err(|e| e.to_string())?;
        if hash_arquivo(&origem)? != arquivo.sha256 {
            return Err("Um arquivo mudou durante o envio. Feche o jogo e tente novamente.".into());
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    if std::fs::metadata(&caminho)
        .map_err(|e| e.to_string())?
        .len()
        > LIMITE_PACOTE
    {
        return Err("Pacote excede 2 GiB.".into());
    }
    std::mem::forget(temporario);
    previa.arquivos = arquivos;
    Ok((caminho, previa))
}

pub fn validar_pacote(caminho: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(caminho).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if zip.len() > LIMITE_ENTRADAS {
        return Err("Pacote contém arquivos demais.".into());
    }
    let mut total = 0u64;
    let mut nomes = std::collections::HashSet::new();
    for i in 0..zip.len() {
        let entrada = zip.by_index(i).map_err(|e| e.to_string())?;
        validar_nome(entrada.name().trim_end_matches('/'))?;
        if !nomes.insert(entrada.name().to_lowercase()) {
            return Err("Caminhos duplicados no pacote.".into());
        }
        if entrada
            .unix_mode()
            .is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Pacote contém link simbólico.".into());
        }
        total = total
            .checked_add(entrada.size())
            .ok_or("Tamanho inválido no pacote.")?;
        if total > LIMITE_EXTRAIDO {
            return Err("Pacote descompactado excede 8 GiB.".into());
        }
    }
    let mut manifesto = String::new();
    if let Ok(entrada) = zip.by_name("dome_manifest.json") {
        if entrada.size() > 16 * 1024 * 1024 {
            return Err("Manifesto grande demais.".into());
        }
        entrada
            .take(16 * 1024 * 1024)
            .read_to_string(&mut manifesto)
            .map_err(|e| e.to_string())?;
    }
    let dados: serde_json::Value = serde_json::from_str(&manifesto).unwrap_or_default();
    if let Some(arquivos) = dados.get("arquivos") {
        let arquivos: Vec<ArquivoSocial> =
            serde_json::from_value(arquivos.clone()).map_err(|e| e.to_string())?;
        if arquivos.len() > LIMITE_ENTRADAS {
            return Err("Manifesto contém arquivos demais.".into());
        }
        let mut nomes_manifesto = std::collections::HashSet::new();
        let mut total_manifesto = 0u64;
        for arquivo in &arquivos {
            validar_nome(&arquivo.caminho)?;
            if !nomes_manifesto.insert(arquivo.caminho.to_lowercase()) {
                return Err("Manifesto contém caminhos duplicados.".into());
            }
            if ["instance.json", "dome_manifest.json"].contains(&arquivo.caminho.as_str()) {
                return Err("Arquivo reservado no conteúdo compartilhado.".into());
            }
            total_manifesto = total_manifesto
                .checked_add(arquivo.tamanho_bytes)
                .ok_or("Tamanho inválido.")?;
            if total_manifesto > LIMITE_EXTRAIDO {
                return Err("Conteúdo completo excede 8 GiB.".into());
            }
        }
        for i in 0..zip.len() {
            let entrada = zip.by_index(i).map_err(|e| e.to_string())?;
            if !entrada.is_dir()
                && entrada.name() != "dome_manifest.json"
                && !nomes_manifesto.contains(&entrada.name().to_lowercase())
            {
                return Err("Pacote contém arquivo não declarado no manifesto.".into());
            }
        }
        for arquivo in arquivos {
            if let Some(referencia) = &arquivo.referencia {
                validar_nome(&arquivo.caminho)?;
                validar_url_modrinth(&referencia.url)?;
                if arquivo.configuracao
                    || !["mods/", "resourcepacks/", "shaderpacks/"]
                        .iter()
                        .any(|p| arquivo.caminho.starts_with(p))
                {
                    return Err("Referência externa fora das pastas de conteúdo.".into());
                }
                continue;
            }
            let mut entrada = zip.by_name(&arquivo.caminho).map_err(|e| e.to_string())?;
            if entrada.size() != arquivo.tamanho_bytes {
                return Err("Tamanho divergente do manifesto.".into());
            }
            let mut hash = Sha256::new();
            let mut buffer = [0; 64 * 1024];
            loop {
                let n = entrada.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            if format!("{:x}", hash.finalize()) != arquivo.sha256 {
                return Err("Integridade do pacote inválida.".into());
            }
        }
    }
    Ok(())
}

fn validar_url_modrinth(endereco: &str) -> Result<(), String> {
    let url = url::Url::parse(endereco).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("cdn.modrinth.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Origem de conteúdo inválida.".into());
    }
    Ok(())
}

pub async fn identificar_modrinth(mut previa: PreviaSocial) -> PreviaSocial {
    use futures::StreamExt;

    let Ok(cliente) = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("DomeLauncher/0.2 (+https://domestudios.com.br)")
        .build()
    else {
        return previa;
    };
    let hashes: Vec<_> = previa
        .arquivos
        .iter()
        .filter(|a| !a.configuracao)
        .map(|a| a.sha512.clone())
        .collect();
    let lotes: Vec<_> = hashes.chunks(100).map(<[String]>::to_vec).collect();
    let respostas = futures::stream::iter(lotes)
        .map(|lote| {
            let cliente = cliente.clone();
            async move {
                let resposta = cliente
                    .post("https://api.modrinth.com/v2/version_files")
                    .json(&serde_json::json!({ "algorithm": "sha512", "hashes": lote }))
                    .send()
                    .await
                    .ok()?;
                if !resposta.status().is_success() {
                    return None;
                }
                resposta.json::<serde_json::Value>().await.ok()
            }
        })
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
    for versoes in respostas.into_iter().flatten() {
        for arquivo in &mut previa.arquivos {
            let Some(versao) = versoes.get(&arquivo.sha512) else {
                continue;
            };
            let Some(arquivos) = versao["files"].as_array() else {
                continue;
            };
            let Some(remoto) = arquivos
                .iter()
                .find(|f| f["hashes"]["sha512"].as_str() == Some(&arquivo.sha512))
            else {
                continue;
            };
            let (Some(url), Some(id)) = (remoto["url"].as_str(), versao["id"].as_str()) else {
                continue;
            };
            if validar_url_modrinth(url).is_ok() {
                arquivo.referencia = Some(ReferenciaModrinth {
                    versao_id: id.into(),
                    url: url.into(),
                });
            }
        }
    }
    previa
}

pub async fn restaurar_referencias(
    pacote: &Path,
    destino: &Path,
    cache: &Path,
) -> Result<(), String> {
    use futures::{StreamExt, TryStreamExt};
    use tokio::io::AsyncWriteExt;
    let arquivos = {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(pacote).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let Ok(entrada) = zip.by_name("dome_manifest.json") else {
            return Ok(());
        };
        let manifesto: serde_json::Value =
            serde_json::from_reader(entrada.take(16 * 1024 * 1024)).map_err(|e| e.to_string())?;
        serde_json::from_value::<Vec<ArquivoSocial>>(manifesto["arquivos"].clone())
            .unwrap_or_default()
    };
    let cliente = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(cache)
        .await
        .map_err(|e| e.to_string())?;
    futures::stream::iter(arquivos.into_iter().filter(|a| a.referencia.is_some()))
        .map(|arquivo| {
            let cliente = cliente.clone();
            async move {
                validar_nome(&arquivo.caminho)?;
                if arquivo.sha256.len() != 64
                    || !arquivo.sha256.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("Hash de referência inválido.".into());
                }
                let referencia = arquivo.referencia.as_ref().ok_or("Referência ausente.")?;
                validar_url_modrinth(&referencia.url)?;
                let armazenado = cache.join(&arquivo.sha256);
                let trava = trava_cache(&arquivo.sha256).await;
                let _guarda = trava.lock().await;
                let valido = armazenado.is_file() && hash_arquivo(&armazenado)? == arquivo.sha256;
                if !valido {
                    let temporario = Temporario(cache.join(uuid::Uuid::new_v4().to_string()));
                    let resposta = cliente
                        .get(&referencia.url)
                        .send()
                        .await
                        .map_err(|_| "Falha ao baixar conteúdo Modrinth.".to_string())?;
                    if !resposta.status().is_success() {
                        return Err("Conteúdo Modrinth indisponível. Tente novamente.".into());
                    }
                    let mut fluxo = resposta.bytes_stream();
                    let mut saida = tokio::fs::File::create(&temporario.0)
                        .await
                        .map_err(|e| e.to_string())?;
                    let mut recebido = 0u64;
                    while let Some(bytes) = fluxo.next().await {
                        let bytes =
                            bytes.map_err(|_| "Download de conteúdo interrompido.".to_string())?;
                        recebido += bytes.len() as u64;
                        if recebido > arquivo.tamanho_bytes || recebido > LIMITE_PACOTE {
                            return Err("Tamanho de conteúdo inválido.".into());
                        }
                        saida.write_all(&bytes).await.map_err(|e| e.to_string())?;
                    }
                    saida.flush().await.map_err(|e| e.to_string())?;
                    drop(saida);
                    if recebido != arquivo.tamanho_bytes
                        || hash_arquivo(&temporario.0)? != arquivo.sha256
                    {
                        return Err("Hash do conteúdo Modrinth inválido.".into());
                    }
                    if armazenado.exists() {
                        std::fs::remove_file(&armazenado).map_err(|e| e.to_string())?;
                    }
                    std::fs::rename(&temporario.0, &armazenado).map_err(|e| e.to_string())?;
                }
                let alvo = destino.join(&arquivo.caminho);
                if let Some(pai) = alvo.parent() {
                    tokio::fs::create_dir_all(pai)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                tokio::fs::copy(armazenado, alvo)
                    .await
                    .map_err(|e| e.to_string())?;
                Ok::<(), String>(())
            }
        })
        .buffer_unordered(8)
        .try_collect::<Vec<_>>()
        .await?;
    Ok(())
}

async fn trava_cache(hash: &str) -> std::sync::Arc<tokio::sync::Mutex<()>> {
    use std::collections::HashMap;
    use std::sync::{Arc, OnceLock, Weak};
    type Travas = tokio::sync::Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>;
    static TRAVAS: OnceLock<Travas> = OnceLock::new();
    let mut travas = TRAVAS.get_or_init(Default::default).lock().await;
    travas.retain(|_, trava| trava.strong_count() > 0);
    if let Some(trava) = travas.get(hash).and_then(Weak::upgrade) {
        return trava;
    }
    let trava = Arc::new(tokio::sync::Mutex::new(()));
    travas.insert(hash.into(), Arc::downgrade(&trava));
    trava
}

#[cfg(test)]
mod testes {
    use super::*;

    fn preparar_instancia() -> (PastaTemporaria, Instance) {
        let raiz = std::env::temp_dir().join(format!("dome-teste-pacote-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(raiz.join("mods")).unwrap();
        std::fs::create_dir_all(raiz.join("config")).unwrap();
        std::fs::create_dir_all(raiz.join("saves")).unwrap();
        std::fs::write(raiz.join("mods/exemplo.jar"), b"conteudo do mod").unwrap();
        std::fs::write(raiz.join("config/exemplo.json"), b"{}").unwrap();
        std::fs::write(raiz.join("saves/mundo.dat"), b"mundo pessoal").unwrap();
        std::fs::write(raiz.join("options.txt"), b"opcoes pessoais").unwrap();
        let instancia = serde_json::from_value(serde_json::json!({
            "id": "teste", "name": "Teste", "version": "1.21.1", "mcType": "vanilla",
            "path": raiz, "created": "2026-09-13"
        }))
        .unwrap();
        (
            PastaTemporaria::nova(&std::env::temp_dir(), &raiz).unwrap(),
            instancia,
        )
    }

    #[test]
    fn exportacao_respeita_selecao_de_pastas_e_nomes_unicos() {
        let (_pasta, instancia) = preparar_instancia();
        let primeiro = Temporario(exportar(&instancia, None, vec![]).unwrap());
        let segundo = Temporario(
            exportar(
                &instancia,
                Some(vec![
                    "mods/exemplo.jar".into(),
                    "config/exemplo.json".into(),
                    "saves/mundo.dat".into(),
                ]),
                vec![],
            )
            .unwrap(),
        );
        assert_ne!(primeiro.0, segundo.0);
        validar_pacote(&primeiro.0).unwrap();
        validar_pacote(&segundo.0).unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&primeiro.0).unwrap()).unwrap();
        assert!(zip.by_name("mods/exemplo.jar").is_ok());
        for nome in [
            "config/exemplo.json",
            "saves/mundo.dat",
            "options.txt",
            "instance.json",
        ] {
            assert!(zip.by_name(nome).is_err());
        }
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&segundo.0).unwrap()).unwrap();
        assert!(zip.by_name("config/exemplo.json").is_ok());
        assert!(zip.by_name("saves/mundo.dat").is_ok());
        assert!(zip.by_name("options.txt").is_err());
    }

    #[test]
    fn previa_rapida_lista_mundos_sem_calcular_hashes() {
        let (_pasta, instancia) = preparar_instancia();
        let previa = previa_rapida(&instancia).unwrap();
        let mundo = previa
            .arquivos
            .iter()
            .find(|arquivo| arquivo.caminho == "saves/mundo.dat")
            .unwrap();
        assert_eq!(mundo.tamanho_bytes, 13);
        assert!(mundo.sha256.is_empty());
        assert!(mundo.sha512.is_empty());
    }

    #[test]
    fn previa_selecionada_ignora_conteudo_desmarcado() {
        let (_pasta, instancia) = preparar_instancia();
        let previa = previa_selecionada(&instancia, &["config/exemplo.json".into()]).unwrap();
        assert_eq!(previa.arquivos.len(), 1);
        assert_eq!(previa.arquivos[0].caminho, "config/exemplo.json");
        assert!(!previa.arquivos[0].sha256.is_empty());
        assert!(!previa.arquivos[0].sha512.is_empty());
    }

    fn escrever_zip(caminho: &Path, entradas: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(std::fs::File::create(caminho).unwrap());
        for (nome, dados) in entradas {
            zip.start_file(*nome, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(dados).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn rejeita_hash_adulterado_e_conteudo_nao_declarado() {
        let (_pasta, instancia) = preparar_instancia();
        let arquivos = previa(&instancia).unwrap().arquivos;
        let manifesto = serde_json::to_vec(&serde_json::json!({ "arquivos": arquivos })).unwrap();
        let caminho = instancia.path.join("adulterado.zip");
        escrever_zip(
            &caminho,
            &[
                ("dome_manifest.json", &manifesto),
                ("mods/exemplo.jar", b"conteudo falso"),
                ("config/exemplo.json", b"{}"),
            ],
        );
        assert!(validar_pacote(&caminho).is_err());
        escrever_zip(
            &caminho,
            &[
                ("dome_manifest.json", br#"{"arquivos":[]}"#),
                ("extra.exe", b"extra"),
            ],
        );
        assert!(validar_pacote(&caminho).is_err());
    }

    #[test]
    fn rejeita_colisao_de_caixa_e_excesso_de_conteudo_referenciado() {
        let (_pasta, instancia) = preparar_instancia();
        let caminho = instancia.path.join("invalido.zip");
        escrever_zip(&caminho, &[("mods/A.jar", b"a"), ("mods/a.jar", b"b")]);
        assert!(validar_pacote(&caminho).is_err());
        let manifesto = serde_json::to_vec(&serde_json::json!({ "arquivos": [{
            "caminho": "mods/a.jar", "tamanhoBytes": LIMITE_EXTRAIDO + 1, "configuracao": false,
            "sha256": "a".repeat(64), "referencia": { "versaoId": "teste", "url": "https://cdn.modrinth.com/a.jar" }
        }] })).unwrap();
        escrever_zip(&caminho, &[("dome_manifest.json", &manifesto)]);
        assert!(validar_pacote(&caminho).is_err());
    }

    #[test]
    fn referencia_modrinth_remove_binario_do_pacote() {
        let (_pasta, instancia) = preparar_instancia();
        let mut arquivos = previa(&instancia).unwrap().arquivos;
        let arquivo = arquivos.iter_mut().find(|a| !a.configuracao).unwrap();
        arquivo.referencia = Some(ReferenciaModrinth {
            versao_id: "teste".into(),
            url: "https://cdn.modrinth.com/exemplo.jar".into(),
        });
        let pacote = Temporario(exportar(&instancia, None, arquivos).unwrap());
        validar_pacote(&pacote.0).unwrap();
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&pacote.0).unwrap()).unwrap();
        assert!(zip.by_name("mods/exemplo.jar").is_err());
    }
    #[test]
    fn rejeita_caminhos_que_escapam_ou_colidem_no_windows() {
        for nome in [
            "../arquivo",
            "C:/arquivo",
            "/arquivo",
            "mods\\arquivo",
            "mods/arquivo.",
        ] {
            assert!(validar_nome(nome).is_err(), "{nome}");
        }
        assert!(validar_nome("mods/exemplo.jar").is_ok());
    }
}
