use super::*;
use serde_json::json;

fn arquivo_fenestra() -> serde_json::Value {
    json!({
        "id": 9118884,
        "fileName": "thefenestratapes-1.2.1-forge-1.20.1.jar",
        "gameVersions": ["Client", "1.20.1", "Forge", "Server"],
        "isAvailable": true,
        "downloadUrl": null,
        "dependencies": [{"modId": 388172, "relationType": 3}]
    })
}

#[test]
fn curseforge_distingue_arquivo_compativel_de_download_indisponivel() {
    let arquivos = [arquivo_fenestra()];
    let selecionado =
        selecionar_arquivo_curseforge_compativel(&arquivos, "mod", "1.20.1", &Some("forge".into()))
            .expect("o arquivo continua compatível mesmo sem download");
    let erro = exigir_download_curseforge(selecionado, "The Fenestra Tapes").unwrap_err();
    assert!(erro.contains("The Fenestra Tapes"));
    assert!(erro.contains("O CurseForge não disponibiliza download para terceiros."));
    assert!(erro.contains("Baixe este mod no próprio CurseForge e importe para a instância."));
    assert!(!erro.contains("dependência obrigatória"));
}

#[test]
fn curseforge_preserva_rejeicao_de_minecraft_loader_extensao_e_indisponibilidade() {
    let arquivo = arquivo_fenestra();
    for (minecraft, loader) in [("1.21.1", "forge"), ("1.20.1", "fabric")] {
        assert!(
            pontuar_arquivo_curseforge(&arquivo, "mod", minecraft, &Some(loader.into())).is_none()
        );
    }
    for (campo, valor) in [
        ("isAvailable", json!(false)),
        ("fileName", json!("pacote.zip")),
    ] {
        let mut invalido = arquivo.clone();
        invalido[campo] = valor;
        assert!(
            pontuar_arquivo_curseforge(&invalido, "mod", "1.20.1", &Some("forge".into())).is_none()
        );
    }
}

#[test]
fn curseforge_prefere_arquivo_com_download_sem_aceitar_loader_errado() {
    let bloqueado = arquivo_fenestra();
    let mut disponivel = bloqueado.clone();
    disponivel["id"] = json!(8673091);
    disponivel["downloadUrl"] = json!("https://example.com/mod.jar");
    let mut incompativel = disponivel.clone();
    incompativel["id"] = json!(9999999);
    incompativel["gameVersions"] = json!(["1.20.1", "Fabric"]);
    let arquivos = [bloqueado, disponivel, incompativel];
    let selecionado =
        selecionar_arquivo_curseforge_compativel(&arquivos, "mod", "1.20.1", &Some("forge".into()))
            .unwrap();
    assert_eq!(selecionado["id"], 8673091);
    assert_eq!(
        exigir_download_curseforge(selecionado, "Mod").unwrap(),
        "https://example.com/mod.jar"
    );
}

#[test]
fn curseforge_trata_url_ausente_nula_ou_vazia_como_download_indisponivel() {
    for url in [json!(null), json!(""), json!("  ")] {
        let mut arquivo = arquivo_fenestra();
        arquivo["downloadUrl"] = url;
        assert!(exigir_download_curseforge(&arquivo, "Mod").is_err());
        assert!(mapear_versao_projeto_curseforge(&arquivo, "mod")
            .unwrap()
            .files
            .is_empty());
    }
    let mut arquivo = arquivo_fenestra();
    arquivo.as_object_mut().unwrap().remove("downloadUrl");
    assert!(exigir_download_curseforge(&arquivo, "Mod").is_err());
}

#[tokio::test]
#[ignore = "consulta o CurseForge real; requer rede e distribuição restrita do Fenestra"]
async fn consulta_remota_fenestra_e_geckolib() {
    let cliente = reqwest::Client::new();
    let loader = Some("forge".into());
    let versoes = listar_versoes_projeto_curseforge(
        "1347822".into(),
        Some("1.20.1".into()),
        loader.clone(),
        Some("mod".into()),
    )
    .await
    .unwrap();
    assert!(!versoes.is_empty());
    assert!(versoes.iter().all(|versao| versao.files.is_empty()));
    for (arquivo, preferir_estaveis) in
        [(None, false), (Some("8673091".into()), false), (None, true)]
    {
        let referencia = ReferenciaModObrigatorio::CurseForge {
            project_id: "1347822".into(),
            file_id: arquivo,
        };
        let erro = resolver_curseforge_obrigatorio(
            &cliente,
            &referencia,
            "1.20.1",
            &loader,
            preferir_estaveis,
        )
        .await
        .err()
        .expect("o autor não disponibiliza download para terceiros");
        assert!(erro.contains("The Fenestra Tapes"), "{erro}");
        assert!(
            erro.contains("não disponibiliza download para terceiros"),
            "{erro}"
        );
    }
    let geckolib = resolver_curseforge_obrigatorio(
        &cliente,
        &ReferenciaModObrigatorio::CurseForge {
            project_id: "388172".into(),
            file_id: None,
        },
        "1.20.1",
        &loader,
        false,
    )
    .await
    .unwrap();
    assert!(geckolib.file_name.contains("forge-1.20.1"));
    assert!(!geckolib.download_url.is_empty());
    let selecoes = [("1347822", "The Fenestra Tapes"), ("388172", "GeckoLib")]
        .into_iter()
        .map(|(id, nome)| SelecaoInstalacaoConteudo {
            id: id.into(),
            nome: nome.into(),
            icone_url: None,
            plataforma: ModPlatform::CurseForge,
            tipo_projeto: "mod".into(),
        })
        .collect();
    let plano = fila::planejar_conteudos(&cliente, selecoes, "1.20.1", &loader).await;
    assert_eq!(plano.falhas.len(), 1);
    assert_eq!(plano.itens.len(), 1);
    assert_eq!(plano.itens[0].project_id, "388172");
    assert_eq!(plano.itens[0].selecoes, ["curseforge:project:388172"]);
}
