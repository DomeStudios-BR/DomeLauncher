use super::*;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) async fn servidor_teste(
    respostas: Vec<(u16, Value)>,
) -> (String, tokio::task::JoinHandle<Vec<(String, Value)>>) {
    let servidor = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", servidor.local_addr().unwrap());
    let tarefa = tokio::spawn(async move {
        let mut requisicoes = Vec::new();
        for (status, resposta) in respostas {
            let (mut conexao, _) = servidor.accept().await.unwrap();
            requisicoes.push(ler_requisicao(&mut conexao).await);
            let corpo = resposta.to_string();
            let resposta = format!(
                "HTTP/1.1 {status} Teste\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}",
                corpo.len()
            );
            conexao.write_all(resposta.as_bytes()).await.unwrap();
        }
        requisicoes
    });
    (base, tarefa)
}

fn assinatura(nome: &str, bytes: &[u8]) -> AssinaturaMod {
    AssinaturaMod {
        nome: nome.into(),
        sha512: format!("{:x}", Sha512::digest(bytes)),
        fingerprint: Some(super::super::assinaturas_conteudo::fingerprint_bytes_curseforge(bytes)),
        caminho: None,
    }
}

#[test]
fn identificacao_exige_correspondencia_exata_e_aceita_curseforge_sem_download() {
    let mod_local = assinatura("renomeado.jar.disabled", b"arquivo original");
    let versao = json!({"project_id": "projeto", "id": "versao", "version_number": "1.2",
        "files": [{"hashes": {"sha512": mod_local.sha512}}]});
    let mut modrinth = json!({mod_local.sha512.clone(): versao});
    let identificado = correspondencia_modrinth(&mod_local, &modrinth).unwrap();
    assert_eq!(identificado.file_name, "renomeado.jar.disabled");
    assert_eq!(identificado.version_id.as_deref(), Some("versao"));
    modrinth[&mod_local.sha512]["files"][0]["hashes"]["sha512"] = json!("outro");
    assert!(correspondencia_modrinth(&mod_local, &modrinth).is_none());

    let arquivo = json!({"file": {"id": 123, "modId": 456,
        "fileFingerprint": mod_local.fingerprint, "downloadUrl": null}});
    let parcial = json!({"data": {"exactMatches": [], "partialMatches": [arquivo.clone()]}});
    assert!(correspondencia_curseforge(&mod_local, &parcial).is_none());
    let exato = json!({"data": {"exactMatches": [arquivo]}});
    let identificado = correspondencia_curseforge(&mod_local, &exato).unwrap();
    assert_eq!(identificado.project_id.as_deref(), Some("456"));
    assert_eq!(identificado.source.as_deref(), Some("curseforge"));
    assert_eq!(identificado.version_id.as_deref(), Some("123"));
}

#[tokio::test]
async fn identificacao_percorre_todos_os_lotes_e_nao_envia_encontrados_ao_curseforge() {
    let assinaturas = (0..205)
        .map(|indice| assinatura(&format!("{indice}.jar"), indice.to_string().as_bytes()))
        .collect::<Vec<_>>();
    let mut resposta = json!({});
    for item in &assinaturas {
        resposta[&item.sha512] = json!({"project_id": "projeto", "id": "versao", "version_number": "1.0",
            "files": [{"hashes": {"sha512": item.sha512}}]});
    }
    let respostas = vec![(200, resposta); 3];
    let (base, servidor) = servidor_teste(respostas).await;
    let resultado = identificar_assinaturas(&reqwest::Client::new(), &assinaturas, &base, &base)
        .await
        .unwrap();
    assert_eq!(resultado.itens.len(), 205);
    assert!(resultado.falhas.is_empty());
    let requisicoes = servidor.await.unwrap();
    assert_eq!(requisicoes.len(), 3);
    let mut tamanhos = requisicoes
        .iter()
        .map(|(_, corpo)| corpo["hashes"].as_array().unwrap().len())
        .collect::<Vec<_>>();
    tamanhos.sort_unstable();
    assert_eq!(tamanhos, [5, 100, 100]);
    for (rota, corpo) in &requisicoes {
        assert_eq!(rota, "/version_files");
        assert_eq!(corpo["algorithm"], "sha512");
    }
}

#[tokio::test]
async fn falha_modrinth_ainda_identifica_curseforge_sem_confirmar_desconhecidos() {
    let reconhecido = assinatura("externo.jar", b"mod conhecido");
    let desconhecido = assinatura("local.jar", b"mod local");
    let (base, servidor) = servidor_teste(vec![
        (503, json!({})),
        (
            200,
            json!({"data": {"exactMatches": [
                {"file": {"id": 12, "modId": 34, "fileFingerprint": reconhecido.fingerprint}}
            ]}}),
        ),
    ])
    .await;
    let resultado = identificar_assinaturas(
        &reqwest::Client::new(),
        &[reconhecido, desconhecido],
        &base,
        &base,
    )
    .await
    .unwrap();
    assert_eq!(resultado.itens.len(), 1);
    assert_eq!(resultado.itens[0].project_id.as_deref(), Some("34"));
    assert_eq!(resultado.falhas.len(), 1);
    assert!(resultado.falhas[0].contains("Modrinth"));
    let requisicoes = servidor.await.unwrap();
    assert_eq!(requisicoes[1].0, "/fingerprints");
    assert_eq!(
        requisicoes[1].1["fingerprints"].as_array().unwrap().len(),
        2
    );
}

#[tokio::test]
async fn resposta_invalida_nao_remove_identificacao_em_cache() {
    let (base, servidor) = servidor_teste(vec![(200, json!([])), (200, json!({"data": {}}))]).await;
    let resultado = identificar_assinaturas(
        &reqwest::Client::new(),
        &[assinatura("local.jar", b"mod")],
        &base,
        &base,
    )
    .await
    .unwrap();
    assert!(resultado.itens.is_empty());
    assert_eq!(resultado.falhas.len(), 2);
    servidor.await.unwrap();
}

#[test]
fn assinaturas_incluem_desativados_e_independem_do_nome() {
    let instancia =
        std::env::temp_dir().join(format!("dome-identificacao-{}", uuid::Uuid::new_v4()));
    let mods = instancia.join("mods");
    std::fs::create_dir_all(&mods).unwrap();
    std::fs::write(mods.join("nome.jar"), b"mod original").unwrap();
    std::fs::write(mods.join("renomeado.JAR.disabled"), b"mod original").unwrap();
    std::fs::write(mods.join("ignorado.zip"), b"outro arquivo").unwrap();
    let assinaturas = ler_assinaturas(&instancia).unwrap();
    assert_eq!(assinaturas.len(), 2);
    assert_eq!(assinaturas[0].sha512, assinaturas[1].sha512);
    assert!(assinaturas.iter().all(|item| item.fingerprint.is_none()));
    let normalizado = super::super::assinaturas_conteudo::fingerprint_bytes_curseforge;
    assert_eq!(normalizado(b"a b\nc\rd\te"), normalizado(b"abcde"));
    std::fs::remove_dir_all(instancia).unwrap();
}

#[tokio::test]
async fn apenas_arquivos_pendentes_consultam_curseforge_e_desconhecido_fica_sem_vinculo() {
    let modrinth = assinatura("um.jar", b"modrinth");
    let curseforge = assinatura("dois.jar.disabled", b"curseforge");
    let desconhecido = assinatura("tres.jar", b"local");
    let resposta_modrinth = json!({modrinth.sha512.clone(): {
        "project_id": "um", "id": "v1", "version_number": "1.0",
        "files": [{"hashes": {"sha512": modrinth.sha512}}]
    }});
    let resposta_curseforge = json!({"data": {"exactMatches": [{"file": {
        "id": 123, "modId": 456, "fileFingerprint": curseforge.fingerprint
    }}]}});
    let (base, servidor) =
        servidor_teste(vec![(200, resposta_modrinth), (200, resposta_curseforge)]).await;
    let resultado = identificar_assinaturas(
        &reqwest::Client::new(),
        &[modrinth, curseforge, desconhecido],
        &base,
        &base,
    )
    .await
    .unwrap();
    assert_eq!(resultado.itens.len(), 3);
    assert_eq!(resultado.itens[0].source.as_deref(), Some("modrinth"));
    assert_eq!(resultado.itens[1].source.as_deref(), Some("curseforge"));
    assert!(resultado.itens[2].project_id.is_none());
    assert!(resultado.falhas.is_empty());
    let requisicoes = servidor.await.unwrap();
    assert_eq!(
        requisicoes[1].1["fingerprints"].as_array().unwrap().len(),
        2
    );
}

#[tokio::test]
#[ignore = "consulta plataformas reais; defina DOME_TESTE_INSTANCIA com uma instância contendo mods"]
async fn consulta_remota_mods_externos() {
    let pasta = std::env::var_os("DOME_TESTE_INSTANCIA").expect("Defina DOME_TESTE_INSTANCIA");
    let mut assinaturas = ler_assinaturas(Path::new(&pasta)).unwrap();
    assinaturas.truncate(100);
    assert!(!assinaturas.is_empty());
    let cliente = reqwest::Client::builder()
        .user_agent("DomeLauncher/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let resultado = identificar_assinaturas(
        &cliente,
        &assinaturas,
        MODRINTH_API_BASE,
        CURSEFORGE_API_BASE,
    )
    .await
    .unwrap();
    assert!(resultado.falhas.is_empty(), "{:?}", resultado.falhas);
    let modrinth = resultado
        .itens
        .iter()
        .filter(|item| item.source.as_deref() == Some("modrinth"))
        .count();
    let curseforge = resultado
        .itens
        .iter()
        .filter(|item| item.source.as_deref() == Some("curseforge"))
        .count();
    println!(
        "{} arquivos: {modrinth} Modrinth, {curseforge} CurseForge",
        assinaturas.len()
    );
    assert!(modrinth + curseforge > 0);
    assert!(resultado
        .itens
        .iter()
        .filter(|item| item.project_id.is_some())
        .all(|item| item.version_id.is_some()));
}

async fn ler_requisicao(conexao: &mut tokio::net::TcpStream) -> (String, Value) {
    let mut bytes = Vec::new();
    let (fim, tamanho) = loop {
        let mut bloco = [0; 4096];
        let lidos = conexao.read(&mut bloco).await.unwrap();
        assert_ne!(lidos, 0);
        bytes.extend_from_slice(&bloco[..lidos]);
        if let Some(fim) = bytes.windows(4).position(|janela| janela == b"\r\n\r\n") {
            let cabecalho = String::from_utf8_lossy(&bytes[..fim]).to_lowercase();
            let tamanho = cabecalho
                .lines()
                .find_map(|linha| {
                    linha
                        .strip_prefix("content-length:")?
                        .trim()
                        .parse::<usize>()
                        .ok()
                })
                .unwrap();
            break (fim + 4, tamanho);
        }
    };
    while bytes.len() < fim + tamanho {
        let mut bloco = [0; 4096];
        let lidos = conexao.read(&mut bloco).await.unwrap();
        assert_ne!(lidos, 0);
        bytes.extend_from_slice(&bloco[..lidos]);
    }
    let rota = String::from_utf8_lossy(&bytes[..fim])
        .split_whitespace()
        .nth(1)
        .unwrap()
        .to_string();

    (
        rota,
        serde_json::from_slice(&bytes[fim..fim + tamanho]).unwrap(),
    )
}

#[tokio::test]
async fn reconhecimento_modrinth_dispensa_fingerprint_e_segunda_leitura() {
    let mut item = assinatura("um.jar", b"mod");
    item.fingerprint = None;
    item.caminho = Some(PathBuf::from("caminho-que-nao-existe.jar"));
    let resposta = json!({item.sha512.clone(): {"project_id": "projeto", "id": "v1", "version_number": "1.0",
        "files": [{"hashes": {"sha512": item.sha512}}]}});
    let (base, servidor) = servidor_teste(vec![(200, resposta)]).await;
    let resultado = identificar_assinaturas(&reqwest::Client::new(), &[item], &base, &base)
        .await
        .unwrap();
    assert!(resultado.falhas.is_empty());
    assert_eq!(resultado.itens[0].project_id.as_deref(), Some("projeto"));
    assert_eq!(servidor.await.unwrap().len(), 1);
}

#[tokio::test]
async fn consultas_de_lotes_avancam_em_paralelo_com_limite() {
    let servidor = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", servidor.local_addr().unwrap());
    let tarefa = tokio::spawn(async move {
        let mut conexoes = Vec::new();
        for _ in 0..LOTES_SIMULTANEOS {
            let (mut conexao, _) = servidor.accept().await.unwrap();
            let (_, corpo) = ler_requisicao(&mut conexao).await;
            conexoes.push((conexao, corpo));
        }
        for (mut conexao, corpo) in conexoes {
            let mut resposta = json!({});
            for hash in corpo["hashes"].as_array().unwrap() {
                let hash = hash.as_str().unwrap();
                resposta[hash] = json!({"project_id": "projeto", "id": "versao", "version_number": "1.0",
                    "files": [{"hashes": {"sha512": hash}}]});
            }
            let corpo = resposta.to_string();
            let resposta = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}", corpo.len());
            conexao.write_all(resposta.as_bytes()).await.unwrap();
        }
    });
    let assinaturas = (0..TAMANHO_LOTE * LOTES_SIMULTANEOS)
        .map(|indice| assinatura(&format!("{indice}.jar"), indice.to_string().as_bytes()))
        .collect::<Vec<_>>();
    let cliente = reqwest::Client::new();
    let resultado = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        identificar_assinaturas(&cliente, &assinaturas, &base, &base),
    )
    .await
    .expect("Lotes ficaram em série")
    .unwrap();
    assert_eq!(resultado.itens.len(), TAMANHO_LOTE * LOTES_SIMULTANEOS);
    assert!(resultado.falhas.is_empty());
    tarefa.await.unwrap();
}
