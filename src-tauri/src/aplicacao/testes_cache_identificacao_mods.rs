use super::super::testes::servidor_teste;
use super::*;
use serde_json::json;

struct InstanciaTeste(PathBuf);

impl InstanciaTeste {
    fn nova() -> Self {
        let pasta = std::env::temp_dir().join(format!("dome-cache-mods-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(pasta.join("mods")).unwrap();
        Self(pasta)
    }

    fn escrever(&self, nome: &str, bytes: &[u8]) {
        std::fs::write(self.0.join("mods").join(nome), bytes).unwrap();
    }
}

impl Drop for InstanciaTeste {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn cache_reutiliza_assinaturas_e_invalida_somente_arquivo_alterado() {
    let instancia = InstanciaTeste::nova();
    instancia.escrever("um.jar", b"um");
    instancia.escrever("dois.jar", b"dois");
    let primeira = preparar(&instancia.0, CacheIdentificacao::default()).unwrap();
    assert_eq!(primeira.arquivos_lidos, 2);
    let segunda = preparar(&instancia.0, primeira.cache).unwrap();
    assert_eq!(segunda.arquivos_lidos, 0);
    assert!(!segunda.alterado);
    instancia.escrever("um.jar", b"outro conteudo");
    let terceira = preparar(&instancia.0, segunda.cache).unwrap();
    assert_eq!(terceira.arquivos_lidos, 1);
    std::fs::rename(
        instancia.0.join("mods/dois.jar"),
        instancia.0.join("mods/dois.jar.disabled"),
    )
    .unwrap();
    let quarta = preparar(&instancia.0, terceira.cache).unwrap();
    assert_eq!(
        quarta.arquivos_lidos, 0,
        "Desativar preserva a assinatura do arquivo."
    );
    assert!(quarta
        .assinaturas
        .iter()
        .any(|item| item.nome == "dois.jar.disabled"));
    assert_eq!(quarta.cache.arquivos.len(), 2);
}

#[test]
fn cache_confere_data_mesmo_quando_tamanho_nao_muda() {
    let instancia = InstanciaTeste::nova();
    instancia.escrever("um.jar", b"antigo");
    let primeira = preparar(&instancia.0, CacheIdentificacao::default()).unwrap();
    let hash_anterior = primeira.assinaturas[0].sha512.clone();
    instancia.escrever("um.jar", b"novo!!");
    let arquivo = std::fs::File::options()
        .write(true)
        .open(instancia.0.join("mods/um.jar"))
        .unwrap();
    arquivo
        .set_times(
            std::fs::FileTimes::new().set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1)),
        )
        .unwrap();
    let segunda = preparar(&instancia.0, primeira.cache).unwrap();
    assert_eq!(segunda.arquivos_lidos, 1);
    assert_ne!(segunda.assinaturas[0].sha512, hash_anterior);
}

#[test]
fn arquivos_ativo_e_desativado_nao_compartilham_identidade_se_conteudo_difere() {
    let instancia = InstanciaTeste::nova();
    instancia.escrever("um.jar", b"ativo");
    instancia.escrever("um.jar.disabled", b"outro");
    let primeira = preparar(&instancia.0, CacheIdentificacao::default()).unwrap();
    assert_ne!(
        primeira.assinaturas[0].sha512,
        primeira.assinaturas[1].sha512
    );
    let segunda = preparar(&instancia.0, primeira.cache).unwrap();
    assert_eq!(segunda.arquivos_lidos, 0);
    assert_ne!(segunda.assinaturas[0].sha512, segunda.assinaturas[1].sha512);
}

#[tokio::test]
async fn cache_persistido_reabre_sem_rede_e_reaproveita_arquivo_renomeado() {
    let instancia = InstanciaTeste::nova();
    instancia.escrever("um.jar", b"mod");
    let assinatura = preparar(&instancia.0, CacheIdentificacao::default())
        .unwrap()
        .assinaturas
        .remove(0);
    let resposta = json!({assinatura.sha512.clone(): {"project_id": "projeto", "id": "v1", "version_number": "1.0",
        "files": [{"hashes": {"sha512": assinatura.sha512}}]}});
    let (base, servidor) = servidor_teste(vec![(200, resposta)]).await;
    let arquivo = instancia.0.join("cache.json");
    let cliente = reqwest::Client::new();
    let primeiro = identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base)
        .await
        .unwrap();
    assert_eq!(primeiro.itens[0].project_id.as_deref(), Some("projeto"));
    assert_eq!(servidor.await.unwrap().len(), 1);
    std::fs::rename(
        instancia.0.join("mods/um.jar"),
        instancia.0.join("mods/outro.jar"),
    )
    .unwrap();
    let segundo = identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base)
        .await
        .unwrap();
    assert!(segundo.falhas.is_empty(), "O servidor já está desligado.");
    assert_eq!(segundo.itens[0].file_name, "outro.jar");
    assert_eq!(segundo.itens[0].version_id.as_deref(), Some("v1"));
    let cache: CacheIdentificacao =
        serde_json::from_slice(&std::fs::read(&arquivo).unwrap()).unwrap();
    assert!(!cache.arquivos.contains_key("um.jar"));
    assert_eq!(cache.identificacoes.len(), 1);
    let restauradas = restaurar_no_arquivo(&instancia.0, &arquivo, &["outro.jar".into()]);
    assert_eq!(
        restauradas["outro.jar"].project_id.as_deref(),
        Some("projeto")
    );
    assert_eq!(restauradas["outro.jar"].version_id.as_deref(), Some("v1"));
    instancia.escrever("outro.jar", b"arquivo substituido");
    assert!(restaurar_no_arquivo(&instancia.0, &arquivo, &["outro.jar".into()]).is_empty());
}

#[tokio::test]
async fn cache_nao_registra_erro_de_rede_como_mod_desconhecido() {
    let instancia = InstanciaTeste::nova();
    instancia.escrever("um.jar", b"mod");
    let (base, servidor) = servidor_teste(vec![
        (503, json!({})),
        (503, json!({})),
        (200, json!({})),
        (200, json!({"data": {"exactMatches": []}})),
    ])
    .await;
    let arquivo = instancia.0.join("cache.json");
    let cliente = reqwest::Client::new();
    let primeiro = identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base)
        .await
        .unwrap();
    assert_eq!(primeiro.falhas.len(), 2);
    let segundo = identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base)
        .await
        .unwrap();
    assert!(segundo.falhas.is_empty());
    assert!(segundo.itens[0].project_id.is_none());
    assert_eq!(servidor.await.unwrap().len(), 4);
    let terceiro = identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base)
        .await
        .unwrap();
    assert!(terceiro.falhas.is_empty());
    assert!(terceiro.itens[0].project_id.is_none());
}

#[test]
fn somente_resultados_desconhecidos_expiram() {
    let mut registro = IdentificacaoCache {
        item: ModIdentificado {
            file_name: "um.jar".into(),
            project_id: None,
            source: None,
            version: None,
            version_id: None,
        },
        consultado_em: 100,
    };
    assert!(registro.valido(100 + DIA - 1));
    assert!(!registro.valido(100 + DIA));
    registro.item.project_id = Some("projeto".into());
    assert!(registro.valido(100 + 29 * DIA));
    assert!(registro.valido(100 + 365 * DIA));
    registro.item.project_id = None;
    assert!(!registro.valido(99));
}

#[tokio::test]
async fn consultas_simultaneas_da_mesma_instancia_reutilizam_resultado() {
    let instancia = InstanciaTeste::nova();
    instancia.escrever("um.jar", b"mod");
    let hash = format!("{:x}", Sha512::digest(b"mod"));
    let resposta = json!({hash.clone(): {"project_id": "projeto", "id": "v1", "version_number": "1.0",
        "files": [{"hashes": {"sha512": hash}}]}});
    let (base, servidor) = servidor_teste(vec![(200, resposta)]).await;
    let arquivo = instancia.0.join("cache.json");
    let cliente = reqwest::Client::new();
    let (primeiro, segundo) = tokio::join!(
        identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base),
        identificar_no_arquivo(&cliente, &instancia.0, &arquivo, &base, &base),
    );
    for resultado in [primeiro.unwrap(), segundo.unwrap()] {
        assert!(resultado.falhas.is_empty());
        assert_eq!(resultado.itens[0].version_id.as_deref(), Some("v1"));
    }
    assert_eq!(servidor.await.unwrap().len(), 1);
}

#[tokio::test]
#[ignore = "mede cache com arquivos e plataformas reais; requer DOME_TESTE_INSTANCIA"]
async fn consulta_remota_desempenho_cache_mods() {
    let caminho = std::env::var_os("DOME_TESTE_INSTANCIA").expect("Defina DOME_TESTE_INSTANCIA");
    let caminho = Path::new(&caminho).canonicalize().unwrap();
    let temporario = InstanciaTeste::nova();
    let arquivo = temporario.0.join("cache.json");
    let cliente = reqwest::Client::builder()
        .user_agent("DomeLauncher/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let inicio = std::time::Instant::now();
    let primeira = identificar_no_arquivo(
        &cliente,
        &caminho,
        &arquivo,
        MODRINTH_API_BASE,
        CURSEFORGE_API_BASE,
    )
    .await
    .unwrap();
    let tempo_primeira = inicio.elapsed();
    assert!(primeira.falhas.is_empty(), "{:?}", primeira.falhas);
    assert!(!primeira.itens.is_empty());
    let inicio = std::time::Instant::now();
    let segunda = identificar_no_arquivo(
        &cliente,
        &caminho,
        &arquivo,
        "http://127.0.0.1:9",
        "http://127.0.0.1:9",
    )
    .await
    .unwrap();
    let tempo_segunda = inicio.elapsed();
    assert!(segunda.falhas.is_empty(), "{:?}", segunda.falhas);
    assert_eq!(primeira.itens.len(), segunda.itens.len());
    println!(
        "{} mods: primeira leitura {:?}; cache {:?}, sem acesso à rede",
        primeira.itens.len(),
        tempo_primeira,
        tempo_segunda
    );
}

#[tokio::test]
#[ignore = "verifica a identificação persistida da instância real; requer DOME_TESTE_INSTANCIA"]
async fn consulta_remota_persistencia_instancia() {
    let caminho = std::env::var_os("DOME_TESTE_INSTANCIA").expect("Defina DOME_TESTE_INSTANCIA");
    let caminho = Path::new(&caminho).canonicalize().unwrap();
    let cliente = reqwest::Client::builder()
        .user_agent("DomeLauncher/1.0")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let resultado =
        identificar_com_cache(&cliente, &caminho, MODRINTH_API_BASE, CURSEFORGE_API_BASE)
            .await
            .unwrap();
    assert!(resultado.falhas.is_empty(), "{:?}", resultado.falhas);
    let nomes = resultado
        .itens
        .iter()
        .map(|item| item.file_name.clone())
        .collect::<Vec<_>>();
    let inicio = std::time::Instant::now();
    let restaurados = restaurar_identificacoes(&caminho, &nomes);
    let tempo = inicio.elapsed();
    let mut modrinth = 0;
    let mut curseforge = 0;
    let mut desconhecidos = Vec::new();
    for item in resultado.itens {
        if item.project_id.is_none() {
            desconhecidos.push(item.file_name);
            continue;
        }
        let salvo = &restaurados[&item.file_name];
        assert_eq!(salvo.project_id, item.project_id);
        assert_eq!(salvo.source, item.source);
        assert_eq!(salvo.version_id, item.version_id);
        assert!(salvo.version_id.is_some());
        match salvo.source.as_deref() {
            Some("modrinth") => modrinth += 1,
            Some("curseforge") => curseforge += 1,
            outra => panic!("Fonte inesperada: {outra:?}"),
        }
    }
    println!(
        "{} identificados: {modrinth} Modrinth e {curseforge} CurseForge; {} sem correspondência",
        restaurados.len(),
        desconhecidos.len()
    );
    println!("Projeto, fonte e versão restaurados do disco em {tempo:?}, sem consulta remota");
    println!("Sem correspondência: {desconhecidos:?}");
}
