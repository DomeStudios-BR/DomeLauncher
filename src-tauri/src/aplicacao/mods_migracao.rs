use super::*;

pub(in crate::aplicacao) async fn repetir_preparacao_mod<T, F, Fut>(
    mut preparar: F,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    for tentativa in 1..=3 {
        match preparar().await {
            Ok(resultado) => return Ok(resultado),
            Err(erro) if tentativa == 3 => {
                return Err(format!(
                    "Falha após {tentativa} tentativas. A instância foi mantida. {erro}"
                ));
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(250 * tentativa)).await,
        }
    }
    unreachable!()
}

pub(super) fn selecionar_versao_modrinth_migracao<'a>(
    versoes: &'a [serde_json::Value],
    minecraft: &str,
    loader: &Option<String>,
) -> Option<&'a serde_json::Value> {
    versoes
        .iter()
        .filter(|versao| {
            versao_modrinth_compativel(versao, minecraft, loader)
                && arquivo_jar_modrinth(versao).is_some()
        })
        .max_by_key(|versao| chave_estabilidade_migracao(versao, false))
}

pub(super) fn chave_estabilidade_migracao(
    versao: &serde_json::Value,
    curseforge: bool,
) -> (u8, i64, u64) {
    let tipo = if curseforge {
        rotulo_tipo_versao_curseforge(versao)
    } else {
        versao["version_type"].as_str().unwrap_or("release")
    };
    let prioridade = match tipo {
        "release" => 3,
        "beta" => 2,
        "alpha" => 1,
        _ => 0,
    };
    let data = versao[if curseforge {
        "fileDate"
    } else {
        "date_published"
    }]
    .as_str()
    .and_then(|data| chrono::DateTime::parse_from_rfc3339(data).ok())
    .map(|data| data.timestamp_millis())
    .unwrap_or(0);
    (prioridade, data, versao["id"].as_u64().unwrap_or(0))
}

pub(super) async fn buscar_arquivo_curseforge_migracao(
    client: &reqwest::Client,
    projeto: &str,
    minecraft: &str,
    loader: &Option<String>,
) -> Result<Option<serde_json::Value>, String> {
    buscar_arquivo_curseforge_migracao_com(projeto, minecraft, loader, |url| {
        anexar_headers_curseforge(client.get(url))
    })
    .await
}

async fn buscar_arquivo_curseforge_migracao_com(
    projeto: &str,
    minecraft: &str,
    loader: &Option<String>,
    preparar: impl Fn(&str) -> Result<reqwest::RequestBuilder, String>,
) -> Result<Option<serde_json::Value>, String> {
    let mut sem_download = None;
    for filtrar_loader in [true, false] {
        let mut indice = 0;
        let mut melhor: Option<serde_json::Value> = None;
        loop {
            let mut url = format!(
                "{}/mods/{}/files?gameVersion={}&pageSize=50&index={}&sortField=1&sortOrder=desc",
                CURSEFORGE_API_BASE,
                projeto,
                urlencoding::encode(minecraft),
                indice
            );
            if filtrar_loader {
                if let Some(id) = loader.as_deref().and_then(id_loader_curseforge) {
                    url.push_str(&format!("&modLoaderType={id}"));
                }
            }
            let payload = preparar(&url)?
                .send()
                .await
                .map_err(|erro| format!("Erro ao consultar versões CurseForge: {erro}"))?
                .error_for_status()
                .map_err(|erro| format!("Falha na consulta CurseForge: {erro}"))?
                .json::<serde_json::Value>()
                .await
                .map_err(|erro| format!("Resposta CurseForge inválida: {erro}"))?;
            let arquivos = payload["data"]
                .as_array()
                .ok_or("Resposta CurseForge sem lista de arquivos.")?;
            for arquivo in arquivos {
                let (versoes, loaders) = extrair_tags_arquivo_curseforge(arquivo);
                if !versoes.iter().any(|versao| versao == minecraft)
                    || (!filtrar_loader
                        && loader.is_some()
                        && !loaders.iter().any(|item| Some(item) == loader.as_ref()))
                    || pontuar_arquivo_curseforge(arquivo, "mod", minecraft, loader).is_none()
                {
                    continue;
                }
                if melhor.as_ref().is_none_or(|anterior| {
                    (
                        url_download_curseforge(arquivo).is_some(),
                        chave_estabilidade_migracao(arquivo, true),
                    ) > (
                        url_download_curseforge(anterior).is_some(),
                        chave_estabilidade_migracao(anterior, true),
                    )
                }) {
                    melhor = Some(arquivo.clone());
                }
            }
            indice += arquivos.len();
            let total = payload["pagination"]["totalCount"]
                .as_u64()
                .unwrap_or(indice as u64);
            if arquivos.is_empty() || indice as u64 >= total {
                break;
            }
            if indice >= 10_000 {
                return Err("Limite da consulta CurseForge atingido ao migrar mods.".into());
            }
        }
        if let Some(arquivo) = melhor {
            if url_download_curseforge(&arquivo).is_some() {
                return Ok(Some(arquivo));
            }
            sem_download.get_or_insert(arquivo);
        }
    }
    Ok(sem_download)
}

fn incompatibilidade_confirmada(erro: &str) -> bool {
    [
        "não possui versão para MC",
        "não possui arquivo para MC",
        "não é compatível com MC",
    ]
    .iter()
    .any(|mensagem| erro.contains(mensagem))
}

/// Retorna ausência somente para incompatibilidade confirmada; falhas de rede interrompem a migração.
pub(in crate::aplicacao) async fn instalar_mod_migracao(
    client: &reqwest::Client,
    pasta: &std::path::Path,
    projeto: String,
    curseforge: bool,
    minecraft: &str,
    loader: &Option<String>,
) -> Result<Option<String>, String> {
    let referencia = if curseforge {
        ReferenciaModObrigatorio::CurseForge {
            project_id: projeto,
            file_id: None,
        }
    } else {
        ReferenciaModObrigatorio::Modrinth {
            project_id: Some(projeto),
            version_id: None,
        }
    };
    let mut etapas = vec![EtapaResolucaoMod::Resolver(referencia)];
    let mut visitados = std::collections::HashSet::new();
    let mut arquivos = Vec::new();
    let mut principal = None;
    while let Some(etapa) = etapas.pop() {
        match etapa {
            EtapaResolucaoMod::Resolver(referencia) => {
                if !visitados.insert(referencia.chave()) {
                    continue;
                }
                let resolvido = match resolver_arquivo_mod_com_preferencia(
                    client,
                    &referencia,
                    minecraft,
                    loader,
                    true,
                )
                .await
                {
                    Ok(arquivo) => arquivo,
                    Err(erro) if incompatibilidade_confirmada(&erro) => return Ok(None),
                    Err(erro) => return Err(erro),
                };
                if principal.is_none() {
                    principal = Some(resolvido.file_name.clone());
                }
                let dependencias = resolvido.dependencias.clone();
                etapas.push(EtapaResolucaoMod::AgendarDownload(resolvido));
                for dependencia in dependencias.into_iter().rev() {
                    etapas.push(EtapaResolucaoMod::Resolver(dependencia));
                }
            }
            EtapaResolucaoMod::AgendarDownload(arquivo) => arquivos.push(arquivo),
        }
    }
    baixar_e_instalar_arquivos_mod(client, pasta, arquivos).await?;
    Ok(principal)
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn repete_preparacao_apos_http_transitorio_e_limita_falha_persistente() {
        let (base, tarefa) = servidor(vec![(503, json!({})), (200, json!({"ok": true}))]).await;
        let cliente = reqwest::Client::builder().no_proxy().build().unwrap();
        let resultado = repetir_preparacao_mod(|| async {
            cliente
                .get(&base)
                .send()
                .await
                .map_err(|erro| erro.to_string())?
                .error_for_status()
                .map_err(|erro| erro.to_string())?
                .json::<serde_json::Value>()
                .await
                .map_err(|erro| erro.to_string())
        })
        .await
        .unwrap();
        assert_eq!(resultado["ok"], true);
        assert_eq!(tarefa.await.unwrap().len(), 2);
        let tentativas = std::sync::atomic::AtomicUsize::new(0);
        let erro = repetir_preparacao_mod(|| async {
            tentativas.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err::<(), _>("Conexão indisponível".into())
        })
        .await
        .unwrap_err();
        assert_eq!(tentativas.load(std::sync::atomic::Ordering::SeqCst), 3);
        assert!(erro.contains("A instância foi mantida"));
    }

    #[test]
    fn modrinth_seleciona_estavel_compativel_e_recua_para_beta_ou_alpha() {
        let criar = |id: &str, tipo: &str, mc: &str, loader: &str, data: &str| {
            json!({
                "id":id, "version_type":tipo, "game_versions":[mc], "loaders":[loader], "date_published":data,
                "files":[{"filename":"mod.jar", "url":"https://example.com/mod.jar"}]
            })
        };
        let versoes = vec![
            criar("alpha", "alpha", "1.21.1", "fabric", "2026-10-01T00:00:00Z"),
            criar("beta", "beta", "1.21.1", "fabric", "2026-09-01T00:00:00Z"),
            criar(
                "estavel",
                "release",
                "1.21.1",
                "fabric",
                "2026-08-01T00:00:00Z",
            ),
            criar(
                "outro-mc",
                "release",
                "1.20.1",
                "fabric",
                "2026-10-01T00:00:00Z",
            ),
            criar(
                "outro-loader",
                "release",
                "1.21.1",
                "forge",
                "2026-10-01T00:00:00Z",
            ),
        ];
        let loader = Some("fabric".into());
        for (limite, esperado) in [(5, "estavel"), (2, "beta"), (1, "alpha")] {
            assert_eq!(
                selecionar_versao_modrinth_migracao(&versoes[..limite], "1.21.1", &loader).unwrap()
                    ["id"],
                esperado
            );
        }
        assert!(selecionar_versao_modrinth_migracao(&versoes, "1.19.2", &loader).is_none());
    }

    async fn servidor(
        respostas: Vec<(u16, serde_json::Value)>,
    ) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let tarefa = tokio::spawn(async move {
            let mut caminhos = Vec::new();
            for (status, dados) in respostas {
                let (mut conexao, _) = listener.accept().await.unwrap();
                let mut buffer = [0; 8192];
                let quantidade = conexao.read(&mut buffer).await.unwrap();
                caminhos.push(
                    String::from_utf8_lossy(&buffer[..quantidade])
                        .lines()
                        .next()
                        .unwrap()
                        .to_string(),
                );
                let corpo = dados.to_string();
                let resposta = format!("HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}", corpo.len());
                conexao.write_all(resposta.as_bytes()).await.unwrap();
            }
            caminhos
        });
        (base, tarefa)
    }

    #[tokio::test]
    async fn curseforge_encontra_estavel_em_outra_pagina_e_valida_loader_no_retorno() {
        let criar = |id, tipo, loader| {
            json!({"id":id, "releaseType":tipo, "gameVersions":["1.21.1",loader],
            "fileName":"mod.jar", "downloadUrl":"https://example.com/mod.jar", "isAvailable":true})
        };
        let (base, tarefa) = servidor(vec![
            (200, json!({"data":[criar(30,3,"Fabric"),criar(20,2,"Fabric")], "pagination":{"totalCount":4}})),
            (200, json!({"data":[criar(1,1,"Fabric"),criar(99,1,"Forge")], "pagination":{"totalCount":4}})),
        ]).await;
        let cliente = reqwest::Client::builder().no_proxy().build().unwrap();
        let arquivo = buscar_arquivo_curseforge_migracao_com(
            "123",
            "1.21.1",
            &Some("fabric".into()),
            |url| Ok(cliente.get(url.replacen(CURSEFORGE_API_BASE, &base, 1))),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(arquivo["id"], 1);
        let caminhos = tarefa.await.unwrap();
        assert!(caminhos[0].contains("index=0"));
        assert!(caminhos[1].contains("index=2"));
    }

    #[tokio::test]
    async fn curseforge_repete_sem_filtro_loader_mas_nao_confunde_falha_com_incompatibilidade() {
        let (base, tarefa) = servidor(vec![
            (200, json!({"data":[],"pagination":{"totalCount":0}})),
            (200, json!({"data":[{"id":1,"releaseType":1,"gameVersions":["1.21.1","NeoForge"],
                "fileName":"mod.jar","downloadUrl":"https://example.com/mod.jar"}],"pagination":{"totalCount":1}})),
        ]).await;
        let cliente = reqwest::Client::builder().no_proxy().build().unwrap();
        let resultado = buscar_arquivo_curseforge_migracao_com(
            "123",
            "1.21.1",
            &Some("neoforge".into()),
            |url| Ok(cliente.get(url.replacen(CURSEFORGE_API_BASE, &base, 1))),
        )
        .await
        .unwrap();
        assert_eq!(resultado.unwrap()["id"], 1);
        let caminhos = tarefa.await.unwrap();
        assert!(caminhos[0].contains("modLoaderType=6"));
        assert!(!caminhos[1].contains("modLoaderType"));
        let (base, tarefa) = servidor(vec![(503, json!({"erro":"indisponível"}))]).await;
        assert!(buscar_arquivo_curseforge_migracao_com(
            "123",
            "1.21.1",
            &Some("fabric".into()),
            |url| Ok(cliente.get(url.replacen(CURSEFORGE_API_BASE, &base, 1)))
        )
        .await
        .is_err());
        tarefa.await.unwrap();
    }

    #[tokio::test]
    async fn curseforge_preserva_arquivo_restrito_sem_classificar_como_incompatibilidade() {
        let restrito = json!({"id":1,"releaseType":1,"gameVersions":["1.20.1","Forge"],
            "fileName":"mod.jar","downloadUrl":null});
        let payload = json!({"data":[restrito],"pagination":{"totalCount":1}});
        let (base, tarefa) = servidor(vec![(200, payload.clone()), (200, payload)]).await;
        let cliente = reqwest::Client::builder().no_proxy().build().unwrap();
        let arquivo =
            buscar_arquivo_curseforge_migracao_com("123", "1.20.1", &Some("forge".into()), |url| {
                Ok(cliente.get(url.replacen(CURSEFORGE_API_BASE, &base, 1)))
            })
            .await
            .unwrap()
            .unwrap();
        let erro = exigir_download_curseforge(&arquivo, "Mod restrito").unwrap_err();
        assert!(!incompatibilidade_confirmada(&erro));
        assert_eq!(tarefa.await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn curseforge_migracao_prefere_download_disponivel_ao_arquivo_estavel_restrito() {
        let restrito = json!({"id":2,"releaseType":1,"gameVersions":["1.20.1","Forge"],
            "fileName":"mod.jar","downloadUrl":null});
        let mut disponivel = restrito.clone();
        disponivel["id"] = json!(1);
        disponivel["releaseType"] = json!(2);
        disponivel["downloadUrl"] = json!("https://example.com/mod.jar");
        let (base, tarefa) = servidor(vec![
            (
                200,
                json!({"data":[restrito],"pagination":{"totalCount":1}}),
            ),
            (
                200,
                json!({"data":[disponivel],"pagination":{"totalCount":1}}),
            ),
        ])
        .await;
        let cliente = reqwest::Client::builder().no_proxy().build().unwrap();
        let arquivo =
            buscar_arquivo_curseforge_migracao_com("123", "1.20.1", &Some("forge".into()), |url| {
                Ok(cliente.get(url.replacen(CURSEFORGE_API_BASE, &base, 1)))
            })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(arquivo["id"], 1);
        assert_eq!(tarefa.await.unwrap().len(), 2);
    }

    #[test]
    fn prefere_estavel_antes_de_beta_e_alpha_e_mais_recente_dentro_do_tipo() {
        for curseforge in [true, false] {
            let versoes = [
                json!({"version_type":"alpha", "releaseType":3, "id":30}),
                json!({"version_type":"beta", "releaseType":2, "id":20}),
                json!({"version_type":"release", "releaseType":1, "id":1}),
                json!({"version_type":"release", "releaseType":1, "id":2,
                    "fileDate":"2026-01-01T00:00:00Z", "date_published":"2026-01-01T00:00:00Z"}),
            ];
            let escolhido = versoes
                .iter()
                .max_by_key(|item| chave_estabilidade_migracao(item, curseforge))
                .unwrap();
            assert_eq!(escolhido["id"], 2);
            let escolhido = versoes[..2]
                .iter()
                .max_by_key(|item| chave_estabilidade_migracao(item, curseforge))
                .unwrap();
            assert_eq!(escolhido["id"], 20);
            assert_eq!(chave_estabilidade_migracao(&versoes[0], curseforge).0, 1);
        }
    }

    #[test]
    fn falha_de_rede_ou_metadados_nao_significa_incompatibilidade() {
        assert!(incompatibilidade_confirmada(
            "O mod 123 não possui versão para MC 1.21.1"
        ));
        for erro in [
            "HTTP 503",
            "Tempo limite",
            "Resposta inválida",
            "sem URL de download",
        ] {
            assert!(!incompatibilidade_confirmada(erro));
        }
    }
}
