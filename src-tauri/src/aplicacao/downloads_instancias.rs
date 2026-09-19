use crate::launcher::VersionDetail;
use futures::{stream, StreamExt};
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, Semaphore};

const LIMITE_DOWNLOADS: usize = 32;
static VAGAS: Semaphore = Semaphore::const_new(LIMITE_DOWNLOADS);
static TRAVAS: OnceLock<Vec<Mutex<()>>> = OnceLock::new();

struct Arquivo {
    url: String,
    destino: PathBuf,
    tamanho: Option<u64>,
    sha1: Option<String>,
}

struct Transferencias {
    cliente: reqwest::Client,
    cache: PathBuf,
}

fn hash_valido(hash: &str) -> bool {
    hash.len() == 40 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn tamanho_valido(caminho: &Path, tamanho: Option<u64>) -> bool {
    tokio::fs::metadata(caminho)
        .await
        .is_ok_and(|dados| dados.is_file() && tamanho.map_or(dados.len() > 0, |t| dados.len() == t))
}

async fn gravar_atomico(caminho: &Path, bytes: &[u8]) -> Result<(), String> {
    let pasta = caminho.parent().ok_or("Arquivo sem diretório pai")?;
    tokio::fs::create_dir_all(pasta)
        .await
        .map_err(|e| e.to_string())?;
    let temporario = pasta.join(format!("{}.part", uuid::Uuid::new_v4()));
    let resultado = async {
        tokio::fs::write(&temporario, bytes).await?;
        tokio::fs::rename(&temporario, caminho).await
    }
    .await;
    if resultado.is_err() {
        let _ = tokio::fs::remove_file(&temporario).await;
    }
    resultado.map_err(|e| format!("Erro ao gravar {}: {}", caminho.display(), e))
}

impl Transferencias {
    async fn obter(&self, arquivo: Arquivo) -> Result<(), String> {
        if tamanho_valido(&arquivo.destino, arquivo.tamanho).await {
            return Ok(());
        }
        let chave = arquivo.sha1.as_deref().filter(|hash| hash_valido(hash));
        let chave = chave
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| format!("{:x}", Sha1::digest(arquivo.url.as_bytes())));
        let travas = TRAVAS.get_or_init(|| (0..256).map(|_| Mutex::new(())).collect());
        let indice = usize::from_str_radix(&chave[..2], 16).map_err(|e| e.to_string())?;
        let _trava = travas[indice].lock().await;
        let _vaga = VAGAS.acquire().await.map_err(|e| e.to_string())?;
        if tamanho_valido(&arquivo.destino, arquivo.tamanho).await {
            return Ok(());
        }
        let caminho_cache = self.cache.join(&chave[..2]).join(&chave);
        if tamanho_valido(&caminho_cache, arquivo.tamanho).await {
            let bytes = tokio::fs::read(&caminho_cache)
                .await
                .map_err(|e| e.to_string())?;
            if self.conteudo_valido(&arquivo, &bytes) {
                return gravar_atomico(&arquivo.destino, &bytes).await;
            }
        }
        let resposta = self
            .cliente
            .get(&arquivo.url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| format!("Erro ao baixar {}: {}", arquivo.url, e))?;
        let bytes = resposta.bytes().await.map_err(|e| e.to_string())?;
        if !self.conteudo_valido(&arquivo, &bytes) {
            return Err(format!(
                "Download incompleto ou corrompido: {}",
                arquivo.url
            ));
        }
        gravar_atomico(&caminho_cache, &bytes).await?;
        gravar_atomico(&arquivo.destino, &bytes).await
    }

    fn conteudo_valido(&self, arquivo: &Arquivo, bytes: &[u8]) -> bool {
        !bytes.is_empty()
            && arquivo.tamanho.is_none_or(|t| bytes.len() as u64 == t)
            && arquivo
                .sha1
                .as_ref()
                .is_none_or(|hash| format!("{:x}", Sha1::digest(bytes)).eq_ignore_ascii_case(hash))
    }

    async fn executar(self: &Arc<Self>, arquivos: Vec<Arquivo>) -> Result<(), String> {
        let mut destinos = std::collections::HashSet::new();
        let arquivos = arquivos
            .into_iter()
            .filter(|a| destinos.insert(a.destino.clone()));
        let mut tarefas = stream::iter(arquivos)
            .map(|arquivo| self.obter(arquivo))
            .buffer_unordered(LIMITE_DOWNLOADS);
        let mut primeiro_erro = None;
        while let Some(resultado) = tarefas.next().await {
            if let Err(erro) = resultado {
                primeiro_erro.get_or_insert(erro);
            }
        }
        primeiro_erro.map_or(Ok(()), Err)
    }
}

async fn baixar_assets(
    transferencias: &Arc<Transferencias>,
    instancia: &Path,
    detalhes: &VersionDetail,
) -> Result<(), String> {
    let indice = &detalhes.asset_index;
    let destino = instancia
        .join("assets/indexes")
        .join(format!("{}.json", indice.id));
    transferencias
        .obter(Arquivo {
            url: indice.url.clone(),
            destino: destino.clone(),
            tamanho: Some(indice.size),
            sha1: Some(indice.sha1.clone()),
        })
        .await?;
    let bytes = tokio::fs::read(destino).await.map_err(|e| e.to_string())?;
    let dados: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let objetos = dados["objects"]
        .as_object()
        .ok_or("Índice de assets inválido")?;
    let mut arquivos = Vec::with_capacity(objetos.len());
    for objeto in objetos.values() {
        let hash = objeto["hash"]
            .as_str()
            .filter(|h| hash_valido(h))
            .ok_or("Hash inválido no índice de assets")?;
        arquivos.push(Arquivo {
            url: format!(
                "https://resources.download.minecraft.net/{}/{}",
                &hash[..2],
                hash
            ),
            destino: instancia.join("assets/objects").join(&hash[..2]).join(hash),
            tamanho: objeto["size"].as_u64(),
            sha1: Some(hash.to_string()),
        });
    }
    transferencias.executar(arquivos).await
}

pub(super) async fn download_instance_files(
    instancia: &Path,
    detalhes: &VersionDetail,
) -> Result<(), String> {
    let inicio = std::time::Instant::now();
    let transferencias = Arc::new(Transferencias {
        cliente: reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?,
        cache: crate::launcher::pasta_dados_launcher().join("cache/arquivos-minecraft"),
    });
    let cliente = &detalhes.downloads.client;
    let mut arquivos = vec![Arquivo {
        url: cliente.url.clone(),
        destino: instancia.join("bin/client.jar"),
        tamanho: Some(cliente.size),
        sha1: Some(cliente.sha1.clone()),
    }];
    let sistema_atual = crate::launcher::nome_sistema_minecraft();
    for biblioteca in &detalhes.libraries {
        let mut permitida = true;
        if let Some(regras) = &biblioteca.rules {
            for regra in regras {
                if let Some(sistema) = &regra.os {
                    if (regra.action == "allow" && sistema.name != sistema_atual)
                        || (regra.action == "disallow" && sistema.name == sistema_atual)
                    {
                        permitida = false;
                    }
                }
            }
        }
        if !permitida {
            continue;
        }
        let Some(downloads) = &biblioteca.downloads else {
            continue;
        };
        if let Some(artefato) = &downloads.artifact {
            if let Some(caminho) = &artefato.path {
                arquivos.push(Arquivo {
                    url: artefato.url.clone(),
                    destino: instancia.join("libraries").join(caminho),
                    tamanho: artefato.size,
                    sha1: artefato.sha1.clone(),
                });
            }
        }
        let nome_nativos = crate::launcher::nome_classifier_nativos();
        if let Some(nativos) = downloads
            .classifiers
            .as_ref()
            .and_then(|c| c.get(nome_nativos))
        {
            if let (Some(url), Some(caminho)) = (nativos["url"].as_str(), nativos["path"].as_str())
            {
                arquivos.push(Arquivo {
                    url: url.to_string(),
                    destino: instancia.join("libraries").join(caminho),
                    tamanho: nativos["size"].as_u64(),
                    sha1: nativos["sha1"].as_str().map(str::to_string),
                });
            }
        }
    }
    let (binarios, assets) = tokio::join!(
        transferencias.executar(arquivos),
        baixar_assets(&transferencias, instancia, detalhes)
    );
    binarios?;
    assets?;
    println!(
        "[Instância] Arquivos preparados em {:.2}s",
        inicio.elapsed().as_secs_f64()
    );
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn servidor(status: &str) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let contador = Arc::new(AtomicUsize::new(0));
        let requisicoes = contador.clone();
        let resposta = format!(
            "HTTP/1.1 {}\r\nContent-Length: 5\r\nConnection: close\r\n\r\nteste",
            status
        );
        let tarefa = tokio::spawn(async move {
            while let Ok((mut conexao, _)) = listener.accept().await {
                let resposta = resposta.clone();
                requisicoes.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut buffer = [0; 4096];
                    let quantidade = conexao.read(&mut buffer).await.unwrap();
                    assert!(quantidade > 0);
                    tokio::time::sleep(std::time::Duration::from_millis(40)).await;
                    let _ = conexao.write_all(resposta.as_bytes()).await;
                });
            }
        });
        (url, contador, tarefa)
    }

    fn preparar() -> (PathBuf, Arc<Transferencias>) {
        let pasta = std::env::temp_dir().join(format!("dome-downloads-{}", uuid::Uuid::new_v4()));
        let transferencias = Arc::new(Transferencias {
            cliente: reqwest::Client::new(),
            cache: pasta.join("cache"),
        });
        (pasta, transferencias)
    }

    fn arquivo(url: &str, destino: PathBuf) -> Arquivo {
        Arquivo {
            url: url.to_string(),
            destino,
            tamanho: Some(5),
            sha1: Some(format!("{:x}", Sha1::digest(b"teste"))),
        }
    }

    #[tokio::test]
    async fn compartilha_download_concorrente_e_reutiliza_cache_sem_rede() {
        let (url, contador, servidor) = servidor("200 OK").await;
        let (pasta, transferencias) = preparar();
        let inicio = std::time::Instant::now();
        transferencias
            .executar(vec![
                arquivo(&url, pasta.join("primeira/client.jar")),
                arquivo(&url, pasta.join("segunda/client.jar")),
            ])
            .await
            .unwrap();
        let frio = inicio.elapsed();
        assert_eq!(contador.load(Ordering::SeqCst), 1);
        servidor.abort();
        let inicio = std::time::Instant::now();
        transferencias
            .obter(arquivo(&url, pasta.join("terceira/client.jar")))
            .await
            .unwrap();
        println!(
            "Cache: primeira transferência {:?}; reutilização offline {:?}",
            frio,
            inicio.elapsed()
        );
        tokio::fs::write(pasta.join("primeira/client.jar"), b"outro")
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read(pasta.join("terceira/client.jar"))
                .await
                .unwrap(),
            b"teste"
        );
        tokio::fs::remove_dir_all(pasta).await.unwrap();
    }

    #[tokio::test]
    async fn rejeita_erro_http_e_hash_incorreto_sem_publicar_arquivo() {
        for status in ["404 Not Found", "200 OK"] {
            let (url, _, servidor) = servidor(status).await;
            let (pasta, transferencias) = preparar();
            let destino = pasta.join("client.jar");
            let mut tarefa = arquivo(&url, destino.clone());
            if status == "200 OK" {
                tarefa.sha1 = Some("0".repeat(40));
            }
            assert!(transferencias.obter(tarefa).await.is_err());
            assert!(!destino.exists());
            assert!(!transferencias.cache.exists());
            servidor.abort();
        }
    }

    #[tokio::test]
    async fn recupera_cache_corrompido_e_destino_truncado() {
        let (url, contador, servidor) = servidor("200 OK").await;
        let (pasta, transferencias) = preparar();
        let destino = pasta.join("client.jar");
        transferencias
            .obter(arquivo(&url, destino.clone()))
            .await
            .unwrap();
        let hash = format!("{:x}", Sha1::digest(b"teste"));
        let cache = transferencias.cache.join(&hash[..2]).join(&hash);
        tokio::fs::write(cache, b"ruimm").await.unwrap();
        tokio::fs::write(&destino, b"te").await.unwrap();
        transferencias
            .obter(arquivo(&url, destino.clone()))
            .await
            .unwrap();
        assert_eq!(contador.load(Ordering::SeqCst), 2);
        assert_eq!(tokio::fs::read(destino).await.unwrap(), b"teste");
        servidor.abort();
        tokio::fs::remove_dir_all(pasta).await.unwrap();
    }

    #[tokio::test]
    async fn executa_arquivos_independentes_em_paralelo() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let servidor = tokio::spawn(async move {
            let mut conexoes = Vec::new();
            for _ in 0..8 {
                let mut conexao = listener.accept().await.unwrap().0;
                let mut buffer = [0; 4096];
                assert!(conexao.read(&mut buffer).await.unwrap() > 0);
                conexoes.push(conexao);
            }
            for mut conexao in conexoes {
                conexao
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nteste",
                    )
                    .await
                    .unwrap();
            }
        });
        let (pasta, transferencias) = preparar();
        let mut grupos = std::collections::HashSet::new();
        let tarefas = (0..1000)
            .filter(|indice| {
                grupos.insert(Sha1::digest(format!("{}/{}", url, indice).as_bytes())[0])
            })
            .take(8)
            .map(|indice| {
                let mut tarefa = arquivo(
                    &format!("{}/{}", url, indice),
                    pasta.join(indice.to_string()),
                );
                tarefa.sha1 = None;
                tarefa
            })
            .collect();
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            transferencias.executar(tarefas),
        )
        .await
        .unwrap()
        .unwrap();
        servidor.await.unwrap();
        tokio::fs::remove_dir_all(pasta).await.unwrap();
    }
}
