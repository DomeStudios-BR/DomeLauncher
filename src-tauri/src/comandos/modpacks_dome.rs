use super::{criar_cliente_http_launcher, extrair_mensagem_erro_launcher, normalizar_api_base_url};
use super::{pacotes_sociais, vinculos_sociais};
use crate::launcher::LauncherState;
use futures::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha512};
use tauri::State;
use tokio::io::AsyncWriteExt;

const LIMITE_PUBLICACAO: u64 = 64 * 1024 * 1024;

fn versao_compativel_com_instancia(
    versao: &Value,
    versao_minecraft: &str,
    loader: Option<&str>,
) -> bool {
    let loader = loader.unwrap_or("vanilla").trim();
    let minecraft_compativel = versao["game_versions"].as_array().is_some_and(|versoes| {
        versoes
            .iter()
            .any(|versao| versao.as_str() == Some(versao_minecraft))
    });
    let loader_compativel = versao["loaders"].as_array().is_some_and(|loaders| {
        loaders.iter().any(|valor| {
            valor
                .as_str()
                .is_some_and(|valor| valor.trim().eq_ignore_ascii_case(loader))
        })
    });
    minecraft_compativel && loader_compativel
}

pub(super) fn normalizar_base_modpacks(valor: &str) -> Result<String, String> {
    let base = normalizar_api_base_url(valor)?;
    let url = url::Url::parse(&base).map_err(|e| e.to_string())?;
    let padrao = option_env!("DOME_API_PUBLIC_URL").unwrap_or("https://api.domestudios.com.br");
    let local =
        cfg!(debug_assertions) && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if (!local && base != padrao.trim_end_matches('/'))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Origem da API de modpacks não autorizada.".into());
    }
    Ok(base)
}

fn normalizar_pacote(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut entrada =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut saida = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for indice in 0..entrada.len() {
        let mut arquivo = entrada.by_index(indice).map_err(|e| e.to_string())?;
        if arquivo.name() == "dome_manifest.json" {
            let manifesto: Value =
                serde_json::from_reader(&mut arquivo).map_err(|e| e.to_string())?;
            let mut publico = serde_json::Map::new();
            for chave in [
                "domeLauncherVersion",
                "nome",
                "versaoMinecraft",
                "mcType",
                "loaderType",
                "loaderVersion",
                "exportadoEm",
                "arquivos",
            ] {
                if let Some(valor) = manifesto.get(chave) {
                    publico.insert(chave.into(), valor.clone());
                }
            }
            for chave in ["mcType", "loaderType"] {
                if let Some(valor) = publico.get(chave).and_then(Value::as_str) {
                    let normalizado = valor.trim().to_ascii_lowercase();
                    publico.insert(chave.into(), Value::String(normalizado));
                }
            }
            if publico.get("mcType").and_then(Value::as_str) == Some("modded") {
                let loader = publico
                    .get("loaderType")
                    .and_then(Value::as_str)
                    .filter(|loader| matches!(*loader, "fabric" | "forge" | "neoforge"))
                    .ok_or("O pacote modificado precisa de um carregador Fabric, Forge ou NeoForge válido.")?
                    .to_string();
                publico.insert("mcType".into(), Value::String(loader));
            }
            if let Some(valor) = publico.get("exportadoEm").and_then(Value::as_str) {
                let data = chrono::DateTime::parse_from_rfc3339(valor)
                    .map_err(|_| "Data de exportação inválida no pacote .dome.".to_string())?;
                publico.insert(
                    "exportadoEm".into(),
                    Value::String(
                        data.with_timezone(&chrono::Utc)
                            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    ),
                );
            }
            saida
                .start_file(
                    "dome_manifest.json",
                    zip::write::SimpleFileOptions::default(),
                )
                .map_err(|e| e.to_string())?;
            serde_json::to_writer(&mut saida, &publico).map_err(|e| e.to_string())?;
            continue;
        }
        if arquivo.name() != "instance.json" {
            saida.raw_copy_file(arquivo).map_err(|e| e.to_string())?;
        }
    }
    Ok(saida.finish().map_err(|e| e.to_string())?.into_inner())
}

#[cfg(test)]
mod testes {
    use super::*;
    use std::io::Write;

    #[test]
    fn atualizacao_aceita_rotulos_locais_dos_loaders_publicados() {
        for (publicado, local) in [
            ("fabric", "Fabric"),
            ("forge", "Forge"),
            ("neoforge", "NeoForge"),
            ("vanilla", "Vanilla"),
        ] {
            let versao = json!({ "game_versions": ["1.20.1"], "loaders": [publicado] });
            assert!(versao_compativel_com_instancia(
                &versao,
                "1.20.1",
                Some(local)
            ));
            assert!(!versao_compativel_com_instancia(
                &versao,
                "1.21.1",
                Some(local)
            ));
            assert!(!versao_compativel_com_instancia(
                &versao,
                "1.20.1",
                Some("quilt")
            ));
        }
    }

    #[test]
    fn atualizacao_consulta_toda_a_lista_de_compatibilidade() {
        let versao = json!({
            "game_versions": ["1.20", "1.20.1"],
            "loaders": ["forge", "fabric"]
        });
        assert!(versao_compativel_com_instancia(
            &versao,
            "1.20.1",
            Some("Fabric")
        ));
        assert!(!versao_compativel_com_instancia(&versao, "1.20.1", None));
        assert!(!versao_compativel_com_instancia(&json!({}), "1.20.1", None));
        let vanilla = json!({ "game_versions": ["1.20.1"], "loaders": ["vanilla"] });
        assert!(versao_compativel_com_instancia(&vanilla, "1.20.1", None));
    }

    #[test]
    fn restringe_origem_antes_de_acessar_a_sessao_protegida() {
        assert!(normalizar_base_modpacks("https://api.domestudios.com.br/").is_ok());
        assert!(normalizar_base_modpacks("https://outro.example").is_err());
        assert!(normalizar_base_modpacks("https://api.domestudios.com.br?destino=outro").is_err());
        assert!(normalizar_base_modpacks("https://usuario@api.domestudios.com.br").is_err());
    }

    #[test]
    fn publicacao_remove_metadados_locais_sem_alterar_conteudo() {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (nome, dados) in [
            ("instance.json", "caminho local privado"),
            (
                "dome_manifest.json",
                "{\"nome\":\"Teste\",\"icon\":\"caminho-local\",\"caminho\":\"privado\"}",
            ),
            ("mods/exemplo.jar", "conteudo"),
        ] {
            zip.start_file(nome, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(dados.as_bytes()).unwrap();
        }
        let bytes = normalizar_pacote(zip.finish().unwrap().into_inner()).unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert!(zip.by_name("instance.json").is_err());
        let mut conteudo = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("mods/exemplo.jar").unwrap(), &mut conteudo)
            .unwrap();
        assert_eq!(conteudo, "conteudo");
        let manifesto: Value =
            serde_json::from_reader(zip.by_name("dome_manifest.json").unwrap()).unwrap();
        assert_eq!(manifesto["nome"], "Teste");
        assert!(manifesto.get("icon").is_none());
        assert!(manifesto.get("caminho").is_none());
    }

    #[test]
    fn publicacao_recusa_tipo_modificado_sem_carregador_conhecido() {
        for loader in [Value::Null, json!(""), json!("desconhecido")] {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            zip.start_file(
                "dome_manifest.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            serde_json::to_writer(
                &mut zip,
                &json!({ "mcType": "modded", "loaderType": loader }),
            )
            .unwrap();
            let resultado = normalizar_pacote(zip.finish().unwrap().into_inner());
            assert!(resultado.unwrap_err().contains("carregador"));
        }
    }

    #[test]
    fn publicacao_normaliza_data_e_loader_de_pacote_exportado() {
        for (tipo, loader, esperado) in [
            ("fabric", "Fabric", "fabric"),
            ("forge", "Forge", "forge"),
            ("neoforge", "NeoForge", "neoforge"),
            ("modded", "Fabric", "fabric"),
            ("modded", "Forge", "forge"),
            ("modded", " NeoForge ", "neoforge"),
        ] {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            zip.start_file(
                "dome_manifest.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            serde_json::to_writer(
                &mut zip,
                &json!({
                    "mcType": tipo,
                    "loaderType": loader,
                    "exportadoEm": "2026-10-02T12:30:45.123456789+00:00"
                }),
            )
            .unwrap();
            let bytes = normalizar_pacote(zip.finish().unwrap().into_inner()).unwrap();
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
            let manifesto: Value =
                serde_json::from_reader(zip.by_name("dome_manifest.json").unwrap()).unwrap();
            assert_eq!(manifesto["mcType"], esperado);
            assert_eq!(manifesto["loaderType"], esperado);
            assert_eq!(manifesto["exportadoEm"], "2026-10-02T12:30:45.123Z");
        }
    }
}

fn validar_id(id: &str) -> Result<(), String> {
    if id.len() != 24 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Identificador de modpack inválido.".into());
    }
    Ok(())
}

fn token_publicador() -> Result<String, String> {
    let sessao = crate::launcher::carregar_sessao_social_local()?
        .ok_or("Entre com a Microsoft para publicar modpacks.")?;
    let sessao: Value = serde_json::from_str(&sessao).map_err(|e| e.to_string())?;
    sessao["accessToken"]
        .as_str()
        .filter(|token| !token.is_empty())
        .map(str::to_string)
        .ok_or("Sessão Dome inválida.".into())
}

#[tauri::command]
pub async fn enviar_midia_modpack_dome(
    api_base_url: String,
    caminho_arquivo: String,
) -> Result<Value, String> {
    let base = normalizar_base_modpacks(&api_base_url)?;
    let token = token_publicador()?;
    let arquivo = std::path::Path::new(&caminho_arquivo);
    let extensao = arquivo
        .extension()
        .and_then(|valor| valor.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extensao.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "mp4" | "webm"
    ) {
        return Err("Selecione uma imagem ou vídeo compatível.".into());
    }
    let tamanho = tokio::fs::metadata(arquivo)
        .await
        .map_err(|e| e.to_string())?
        .len();
    let limite = if matches!(extensao.as_str(), "mp4" | "webm") {
        LIMITE_PUBLICACAO
    } else {
        16 * 1024 * 1024
    };
    if tamanho == 0 || tamanho > limite {
        return Err("Imagens da descrição podem ter até 16 MiB e vídeos até 64 MiB.".into());
    }
    let mut entrada = tokio::fs::File::open(arquivo)
        .await
        .map_err(|e| e.to_string())?;
    let mut dados = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(
        &mut tokio::io::AsyncReadExt::take(&mut entrada, limite + 1),
        &mut dados,
    )
    .await
    .map_err(|e| e.to_string())?;
    if dados.len() as u64 > limite {
        return Err("O anexo excede o tamanho permitido.".into());
    }
    let resposta = criar_cliente_http_launcher()?
        .post(format!("{base}/api/launcher/modpacks/midias"))
        .bearer_auth(token)
        .header("Content-Type", "application/octet-stream")
        .body(dados)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Não foi possível enviar o anexo.").await,
        );
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn gerenciar_modpacks_dome(
    api_base_url: String,
    acao: String,
    id: Option<String>,
    dados: Option<Value>,
) -> Result<Value, String> {
    let base = normalizar_base_modpacks(&api_base_url)?;
    let endpoint = format!("{base}/api/launcher/modpacks");
    let cliente = criar_cliente_http_launcher()?;
    let dados = dados.unwrap_or_else(|| json!({}));
    let identificador = id.unwrap_or_default();
    let requisicao = match acao.as_str() {
        "buscar" => cliente.get(&endpoint).query(&[
            (
                "busca",
                dados["busca"].as_str().unwrap_or_default().to_string(),
            ),
            (
                "minecraft",
                dados["minecraft"].as_str().unwrap_or_default().to_string(),
            ),
            (
                "loader",
                dados["loader"].as_str().unwrap_or_default().to_string(),
            ),
            (
                "sort",
                dados["sort"].as_str().unwrap_or("relevancia").to_string(),
            ),
            ("offset", dados["offset"].as_u64().unwrap_or(0).to_string()),
            ("limit", dados["limit"].as_u64().unwrap_or(20).to_string()),
        ]),
        "detalhes" | "versoes" => {
            validar_id(&identificador)?;
            let sufixo = if acao == "versoes" { "/versoes" } else { "" };
            cliente.get(format!("{endpoint}/{identificador}{sufixo}"))
        }
        "permissao" | "meus" => cliente
            .get(format!("{endpoint}/{acao}"))
            .bearer_auth(token_publicador()?),
        "minhas-versoes" => {
            validar_id(&identificador)?;
            cliente
                .get(format!("{endpoint}/{identificador}/minhas-versoes"))
                .bearer_auth(token_publicador()?)
        }
        "excluir" | "excluir-versao" => {
            validar_id(&identificador)?;
            let sufixo = if acao == "excluir-versao" {
                let versao = dados["versaoId"].as_str().unwrap_or_default();
                validar_id(versao)?;
                format!("versoes/{versao}")
            } else {
                "definitivo".to_string()
            };
            cliente
                .delete(format!("{endpoint}/{identificador}/{sufixo}"))
                .bearer_auth(token_publicador()?)
        }
        "criar" => cliente
            .post(endpoint)
            .bearer_auth(token_publicador()?)
            .json(&dados),
        "editar" | "retirar" => {
            validar_id(&identificador)?;
            let url = format!("{endpoint}/{identificador}");
            let requisicao = if acao == "editar" {
                cliente.patch(url).json(&dados)
            } else {
                cliente.delete(url)
            };
            requisicao.bearer_auth(token_publicador()?)
        }
        _ => return Err("Ação de modpack inválida.".into()),
    };
    let resposta = requisicao
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao consultar modpacks Dome.").await,
        );
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn publicar_versao_modpack_dome(
    api_base_url: String,
    projeto_id: String,
    caminho_arquivo: String,
    dados: Value,
) -> Result<Value, String> {
    validar_id(&projeto_id)?;
    let base = normalizar_base_modpacks(&api_base_url)?;
    let token = token_publicador()?;
    let caminho = std::path::PathBuf::from(caminho_arquivo);
    if caminho.extension().and_then(|ext| ext.to_str()) != Some("dome") {
        return Err("Selecione um arquivo .dome.".into());
    }
    if tokio::fs::metadata(&caminho)
        .await
        .map_err(|e| e.to_string())?
        .len()
        > LIMITE_PUBLICACAO
    {
        return Err(
            "O pacote excede 64 MiB. Publique a partir de uma instância para referenciar os mods."
                .into(),
        );
    }
    let validacao = caminho.clone();
    tauri::async_runtime::spawn_blocking(move || pacotes_sociais::validar_pacote(&validacao))
        .await
        .map_err(|e| e.to_string())??;
    let bytes = tokio::fs::read(&caminho).await.map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMITE_PUBLICACAO {
        return Err("Pacote excede 64 MiB.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || normalizar_pacote(bytes))
        .await
        .map_err(|e| e.to_string())??;
    let metadados = serde_json::to_vec(&dados).map_err(|e| e.to_string())?;
    if metadados.len() > 256 * 1024 {
        return Err("Notas da versão muito grandes.".into());
    }
    let mut corpo = (metadados.len() as u32).to_be_bytes().to_vec();
    corpo.extend(metadados);
    corpo.extend(bytes);
    let resposta = criar_cliente_http_launcher()?
        .post(format!("{base}/api/launcher/modpacks/{projeto_id}/versoes"))
        .bearer_auth(token)
        .header("Content-Type", "application/octet-stream")
        .body(corpo)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao publicar versão.").await);
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn instalar_modpack_dome(
    api_base_url: String,
    projeto_id: String,
    versao_id: String,
    instancia_id: Option<String>,
    substituir_alteracoes_locais: bool,
    state: State<'_, LauncherState>,
) -> Result<String, String> {
    validar_id(&projeto_id)?;
    validar_id(&versao_id)?;
    let base = normalizar_base_modpacks(&api_base_url)?;
    let projeto = gerenciar_modpacks_dome(
        base.clone(),
        "detalhes".into(),
        Some(projeto_id.clone()),
        None,
    )
    .await?;
    let versoes = gerenciar_modpacks_dome(
        base.clone(),
        "versoes".into(),
        Some(projeto_id.clone()),
        None,
    )
    .await?;
    let versao = versoes
        .as_array()
        .and_then(|lista| lista.iter().find(|item| item["id"] == versao_id))
        .ok_or("Versão não encontrada.")?;
    let existente = if let Some(id) = instancia_id {
        let instancia = crate::comandos::instancia_sistema::obter_instancia_por_id(&state, &id)?;
        if state.obter_pid_instancia(&id).is_some() {
            return Err("Feche o jogo antes de atualizar.".into());
        }
        let bytes =
            std::fs::read(instancia.path.join("modpack-dome.json")).map_err(|e| e.to_string())?;
        let vinculo: vinculos_sociais::VinculoSocial =
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if vinculo.compartilhamento_id != projeto_id || vinculo.api_base_url != base {
            return Err("Esta instância não pertence ao modpack escolhido.".into());
        }
        if !versao_compativel_com_instancia(
            versao,
            &instancia.version,
            instancia.loader_type.as_deref(),
        ) {
            return Err("A atualização exige a mesma versão do Minecraft e o mesmo loader.".into());
        }
        Some((instancia, vinculo))
    } else {
        None
    };
    let resposta = criar_cliente_http_launcher()?
        .get(format!(
            "{base}/api/launcher/modpacks/{projeto_id}/versoes/{versao_id}/arquivo"
        ))
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao baixar modpack.").await);
    }
    let pasta = std::env::temp_dir().join("dome-modpacks");
    tokio::fs::create_dir_all(&pasta)
        .await
        .map_err(|e| e.to_string())?;
    let caminho = pasta.join(format!("{}.dome", uuid::Uuid::new_v4()));
    let _temporario = pacotes_sociais::Temporario(caminho.clone());
    let mut arquivo = tokio::fs::File::create(&caminho)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = resposta.bytes_stream();
    let mut hash = Sha512::new();
    let mut tamanho = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.without_url().to_string())?;
        tamanho += chunk.len() as u64;
        if tamanho > LIMITE_PUBLICACAO {
            return Err("Download excede o limite do beta.".into());
        }
        hash.update(&chunk);
        arquivo.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    arquivo.flush().await.map_err(|e| e.to_string())?;
    drop(arquivo);
    if versao["files"][0]["hashes"]["sha512"].as_str()
        != Some(format!("{:x}", hash.finalize()).as_str())
    {
        return Err("A integridade do download não confere.".into());
    }
    let raiz = state.caminho_instancias()?.join(".social-staging");
    std::fs::create_dir_all(&raiz).map_err(|e| e.to_string())?;
    let pasta_preparacao = raiz.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&pasta_preparacao).map_err(|e| e.to_string())?;
    let _preparacao = pacotes_sociais::PastaTemporaria::nova(&raiz, &pasta_preparacao)?;
    let estado_preparacao = LauncherState {
        account: state.account.clone(),
        accounts: state.accounts.clone(),
        processos_instancias: state.processos_instancias.clone(),
        instances_path: std::sync::Arc::new(std::sync::Mutex::new(pasta_preparacao)),
    };
    let resultado = crate::aplicacao::importacao_exportacao::importar_instancia_social_em_estado(
        caminho.to_string_lossy().into(),
        &estado_preparacao,
    )
    .await?;
    let mut preparada = crate::comandos::instancia_sistema::obter_instancia_por_id(
        &estado_preparacao,
        resultado
            .instancia_id
            .as_deref()
            .ok_or("Instância não foi preparada.")?,
    )?;
    if let Some(nome) = projeto["title"].as_str() {
        preparada.name = nome.to_string();
        if existente.is_none() {
            let instancias = state.get_instances().map_err(|e| e.to_string())?;
            let mut numero = 2;
            while instancias
                .iter()
                .any(|instancia| instancia.name == preparada.name)
            {
                preparada.name = format!("{nome} ({numero})");
                numero += 1;
            }
        }
    }
    pacotes_sociais::restaurar_referencias(
        &caminho,
        &preparada.path,
        &crate::launcher::pasta_cache_social(),
    )
    .await?;
    if existente.is_some() {
        for arquivo in [
            "options.txt",
            "optionsof.txt",
            "optionsshaders.txt",
            "servers.dat",
        ] {
            let caminho = preparada.path.join(arquivo);
            if caminho.exists() {
                std::fs::remove_file(caminho).map_err(|e| e.to_string())?;
            }
        }
    }
    let preparada_previa = preparada.clone();
    let mut arquivos =
        tauri::async_runtime::spawn_blocking(move || pacotes_sociais::previa(&preparada_previa))
            .await
            .map_err(|e| e.to_string())?
            .map(|previa| previa.arquivos)?;
    arquivos.retain(|arquivo| {
        ![
            "options.txt",
            "optionsof.txt",
            "optionsshaders.txt",
            "servers.dat",
        ]
        .contains(&arquivo.caminho.as_str())
    });
    let vinculo = vinculos_sociais::VinculoSocial {
        compartilhamento_id: projeto_id.clone(),
        api_base_url: base,
        versao: 1,
        arquivos,
        substituir_alteracoes_locais,
    };
    let estado_final = LauncherState {
        account: state.account.clone(),
        accounts: state.accounts.clone(),
        processos_instancias: state.processos_instancias.clone(),
        instances_path: state.instances_path.clone(),
    };
    let instalada = tauri::async_runtime::spawn_blocking(move || {
        vinculos_sociais::publicar_modpack_local(&estado_final, preparada, existente, vinculo)
    })
    .await
    .map_err(|e| e.to_string())??;
    let info = serde_json::from_value(json!({
        "projectId": projeto_id, "versionId": versao_id, "name": projeto["title"],
        "author": projeto["author"], "icon": projeto["icon_url"], "slug": projeto["slug"],
        "source": "dome", "installedVersion": versao["version_number"]
    }))
    .map_err(|e| e.to_string())?;
    crate::comandos::modpacks::save_modpack_info(state, instalada.id.clone(), info).await?;
    Ok(instalada.id)
}
