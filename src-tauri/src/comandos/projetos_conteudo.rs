use futures::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{Cursor, Read};
use std::time::Duration;

use super::social_launcher::{modpacks_dome, pacotes_sociais};

pub(crate) fn cliente() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent("DomeLauncher/0.4 (+https://domestudios.com.br)")
        .build()
        .map_err(|erro| erro.to_string())
}

fn validar_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Identificador de projeto ou versão inválido.".into());
    }
    Ok(())
}

pub(crate) async fn json_remoto(requisicao: reqwest::RequestBuilder) -> Result<Value, String> {
    requisicao
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?
        .error_for_status()
        .map_err(|e| format!("Falha na consulta: {}", e.status().unwrap_or_default()))?
        .json()
        .await
        .map_err(|e| format!("Resposta inválida: {e}"))
}

pub(crate) async fn versao_remota(
    fonte: &str,
    projeto_id: &str,
    versao_id: &str,
) -> Result<Value, String> {
    validar_id(projeto_id)?;
    validar_id(versao_id)?;
    let cliente = cliente()?;
    match fonte {
        "modrinth" => {
            let versao = json_remoto(
                cliente.get(format!("https://api.modrinth.com/v2/version/{versao_id}")),
            )
            .await?;
            if versao["project_id"].as_str() != Some(projeto_id) {
                return Err("A versão não pertence ao projeto escolhido.".into());
            }
            Ok(versao)
        }
        "curseforge" => {
            let projeto = projeto_id
                .parse::<u64>()
                .map_err(|_| "Projeto CurseForge inválido.")?;
            let versao = versao_id
                .parse::<u64>()
                .map_err(|_| "Arquivo CurseForge inválido.")?;
            if projeto == 0 || versao == 0 {
                return Err("Identificador CurseForge inválido.".into());
            }
            let dados = json_remoto(crate::anexar_headers_curseforge(cliente.get(format!(
                "{}/mods/{projeto}/files/{versao}",
                crate::CURSEFORGE_API_BASE
            )))?)
            .await?;
            if dados["data"]["modId"].as_u64() != Some(projeto) {
                return Err("O arquivo não pertence ao projeto escolhido.".into());
            }
            Ok(dados["data"].clone())
        }
        "dome" => {
            let versoes = modpacks_dome::gerenciar_modpacks_dome(
                base_dome(),
                "versoes".into(),
                Some(projeto_id.into()),
                None,
            )
            .await?;
            versoes
                .as_array()
                .and_then(|lista| lista.iter().find(|v| v["id"] == versao_id))
                .cloned()
                .ok_or_else(|| "Versão Dome não encontrada.".into())
        }
        _ => Err("Fonte de conteúdo inválida.".into()),
    }
}

fn base_dome() -> String {
    option_env!("DOME_API_PUBLIC_URL")
        .unwrap_or("https://api.domestudios.com.br")
        .trim_end_matches('/')
        .into()
}

pub(crate) async fn baixar_pacote(
    fonte: &str,
    projeto_id: &str,
    versao: &Value,
) -> Result<Vec<u8>, String> {
    baixar_pacote_com_progresso(
        fonte,
        projeto_id,
        versao,
        &super::progresso_operacao::Acompanhamento::default(),
    )
    .await
}

pub(crate) async fn baixar_pacote_com_progresso(
    fonte: &str,
    projeto_id: &str,
    versao: &Value,
    progresso: &super::progresso_operacao::Acompanhamento,
) -> Result<Vec<u8>, String> {
    let url = match fonte {
        "modrinth" => versao["files"]
            .as_array()
            .and_then(|arquivos| {
                arquivos
                    .iter()
                    .find(|a| a["primary"] == true)
                    .or_else(|| arquivos.first())
            })
            .and_then(|a| a["url"].as_str())
            .ok_or("Pacote sem URL de download.")?
            .to_string(),
        "curseforge" => versao["downloadUrl"]
            .as_str()
            .filter(|url| !url.is_empty())
            .ok_or("O download desta versão não está disponível pelo launcher.")?
            .into(),
        "dome" => format!(
            "{}/api/launcher/modpacks/{projeto_id}/versoes/{}/arquivo",
            base_dome(),
            versao["id"].as_str().ok_or("Versão inválida.")?
        ),
        _ => return Err("Fonte inválida.".into()),
    };
    let resposta = cliente()?
        .get(&url)
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?
        .error_for_status()
        .map_err(|e| e.without_url().to_string())?;
    let total_bytes = resposta.content_length().unwrap_or(0);
    let mut resposta = resposta.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(parte) = resposta.next().await {
        let parte = parte.map_err(|e| e.without_url().to_string())?;
        if bytes.len() + parte.len() > pacotes_sociais::LIMITE_PACOTE as usize {
            return Err("O pacote excede o limite de download.".into());
        }
        bytes.extend_from_slice(&parte);
        progresso.informar("Baixando modpack", bytes.len() as u64, total_bytes);
    }
    use sha2::Digest;
    let hash = if fonte == "curseforge" {
        versao["hashes"]
            .as_array()
            .and_then(|lista| lista.iter().find(|h| h["algo"] == 1))
            .and_then(|h| h["value"].as_str())
            .map(|h| ("sha1", h))
    } else {
        versao["files"]
            .as_array()
            .and_then(|lista| {
                lista
                    .iter()
                    .find(|a| a["primary"] == true)
                    .or_else(|| lista.first())
            })
            .and_then(|a| a["hashes"]["sha512"].as_str().map(|h| ("sha512", h)))
    };
    if let Some((algoritmo, esperado)) = hash {
        let obtido = if algoritmo == "sha1" {
            format!("{:x}", sha1::Sha1::digest(&bytes))
        } else {
            format!("{:x}", sha2::Sha512::digest(&bytes))
        };
        if !obtido.eq_ignore_ascii_case(esperado) {
            return Err("A integridade do pacote não confere.".into());
        }
    }
    progresso.concluir("Pacote conferido");
    Ok(bytes)
}

pub(crate) fn ler_manifesto(bytes: &[u8], nome: &str) -> Result<Value, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let arquivo = zip
        .by_name(nome)
        .map_err(|_| format!("Pacote sem {nome}."))?;
    if arquivo.size() > 32 * 1024 * 1024 {
        return Err("Manifesto muito grande.".into());
    }
    serde_json::from_reader(arquivo.take(32 * 1024 * 1024)).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConteudoRelacionado {
    nome: String,
    versao: String,
    arquivo: String,
    icone: Option<String>,
    projeto_id: Option<String>,
    fonte: Option<String>,
    tipo: Option<String>,
    obrigatoria: Option<bool>,
    #[serde(skip)]
    versao_id: Option<String>,
}

fn conteudo_arquivo(arquivo: &str) -> ConteudoRelacionado {
    ConteudoRelacionado {
        nome: arquivo.rsplit('/').next().unwrap_or(arquivo).into(),
        versao: String::new(),
        arquivo: arquivo.into(),
        icone: None,
        projeto_id: None,
        fonte: None,
        tipo: None,
        obrigatoria: None,
        versao_id: None,
    }
}

async fn conteudos_curseforge(
    referencias: &[(u64, Option<u64>)],
    somente_mods: bool,
) -> Result<Vec<ConteudoRelacionado>, String> {
    let cliente = cliente()?;
    let mut projetos = std::collections::HashMap::new();
    let mut arquivos = std::collections::HashMap::new();
    for lote in referencias.chunks(50) {
        let ids: Vec<_> = lote.iter().map(|(id, _)| *id).collect();
        let dados = json_remoto(crate::anexar_headers_curseforge(
            cliente
                .post(format!("{}/mods", crate::CURSEFORGE_API_BASE))
                .json(&json!({"modIds": ids})),
        )?)
        .await?;
        for projeto in dados["data"].as_array().ok_or("Resposta sem projetos.")? {
            if let Some(id) = projeto["id"].as_u64() {
                projetos.insert(id, projeto.clone());
            }
        }
        let ids: Vec<_> = lote.iter().filter_map(|(_, id)| *id).collect();
        if ids.is_empty() {
            continue;
        }
        let dados = json_remoto(crate::anexar_headers_curseforge(
            cliente
                .post(format!("{}/mods/files", crate::CURSEFORGE_API_BASE))
                .json(&json!({"fileIds": ids})),
        )?)
        .await?;
        for arquivo in dados["data"].as_array().ok_or("Resposta sem arquivos.")? {
            if let Some(id) = arquivo["id"].as_u64() {
                arquivos.insert(id, arquivo.clone());
            }
        }
    }
    referencias
        .iter()
        .filter_map(|(id, arquivo_id)| {
            let projeto = match projetos.get(id) {
                Some(projeto) => projeto,
                None => return Some(Err(format!("Projeto CurseForge {id} não retornado."))),
            };
            if somente_mods
                && projeto["classId"]
                    .as_u64()
                    .is_some_and(|classe| classe != 6)
            {
                return None;
            }
            let arquivo = arquivo_id.and_then(|id| arquivos.get(&id));
            if arquivo_id.is_some() && arquivo.is_none() {
                return Some(Err(format!("Arquivo CurseForge de {id} não retornado.")));
            }
            Some(Ok(ConteudoRelacionado {
                nome: projeto["name"].as_str().unwrap_or_default().into(),
                versao: arquivo
                    .and_then(|a| a["displayName"].as_str())
                    .unwrap_or_default()
                    .into(),
                arquivo: arquivo
                    .and_then(|a| a["fileName"].as_str())
                    .unwrap_or_default()
                    .into(),
                icone: projeto["logo"]["thumbnailUrl"].as_str().map(str::to_string),
                projeto_id: Some(id.to_string()),
                fonte: Some("curseforge".into()),
                tipo: match projeto["classId"].as_u64() {
                    Some(12) => Some("resourcepack".into()),
                    Some(6552) => Some("shader".into()),
                    Some(6) => Some("mod".into()),
                    _ => None,
                },
                obrigatoria: None,
                versao_id: None,
            }))
        })
        .collect()
}

async fn dependencia_modrinth(dependencia: &Value) -> Result<ConteudoRelacionado, String> {
    let cliente = cliente()?;
    let versao = if let Some(id) = dependencia["version_id"].as_str() {
        validar_id(id)?;
        Some(json_remoto(cliente.get(format!("https://api.modrinth.com/v2/version/{id}"))).await?)
    } else {
        None
    };
    let projeto_id = dependencia["project_id"]
        .as_str()
        .or_else(|| versao.as_ref().and_then(|v| v["project_id"].as_str()));
    let Some(id) = projeto_id else {
        return Ok(conteudo_arquivo(
            dependencia["file_name"]
                .as_str()
                .ok_or("Dependência sem identidade.")?,
        ));
    };
    validar_id(id)?;
    let projeto =
        json_remoto(cliente.get(format!("https://api.modrinth.com/v2/project/{id}"))).await?;
    Ok(ConteudoRelacionado {
        nome: projeto["title"].as_str().unwrap_or(id).into(),
        versao: versao
            .as_ref()
            .and_then(|v| v["version_number"].as_str())
            .unwrap_or_default()
            .into(),
        arquivo: dependencia["file_name"].as_str().unwrap_or_default().into(),
        icone: projeto["icon_url"].as_str().map(str::to_string),
        projeto_id: Some(id.into()),
        fonte: Some("modrinth".into()),
        tipo: projeto["project_type"].as_str().map(str::to_string),
        obrigatoria: Some(dependencia["dependency_type"] == "required"),
        versao_id: None,
    })
}

fn identificar_referencia(conteudo: &mut ConteudoRelacionado, referencia: &Value) {
    if let Some(versao_id) = referencia["versaoId"].as_str() {
        conteudo.versao_id = Some(versao_id.into());
        conteudo.fonte = Some("modrinth".into());
    }
    let endereco = referencia["url"]
        .as_str()
        .or_else(|| referencia["downloads"][0].as_str());
    let Some(url) = endereco.and_then(|url| url::Url::parse(url).ok()) else {
        return;
    };
    if url.host_str() != Some("cdn.modrinth.com") {
        return;
    }
    let partes: Vec<_> = url.path().split('/').collect();
    if partes.len() >= 6 && partes[1] == "data" && partes[3] == "versions" {
        conteudo.projeto_id = Some(partes[2].into());
        conteudo.versao_id = Some(partes[4].into());
        conteudo.fonte = Some("modrinth".into());
    }
}

async fn enriquecer_modrinth(conteudos: &mut [ConteudoRelacionado]) -> Result<(), String> {
    let cliente = cliente()?;
    let ids: Vec<_> = conteudos
        .iter()
        .filter_map(|c| c.versao_id.clone())
        .collect();
    for lote in ids.chunks(100) {
        let dados = json_remoto(
            cliente
                .get("https://api.modrinth.com/v2/versions")
                .query(&[(
                    "ids",
                    serde_json::to_string(lote).map_err(|e| e.to_string())?,
                )]),
        )
        .await?;
        for versao in dados.as_array().ok_or("Resposta sem versões Modrinth.")? {
            for conteudo in conteudos
                .iter_mut()
                .filter(|c| c.versao_id.as_deref() == versao["id"].as_str())
            {
                conteudo.versao = versao["version_number"].as_str().unwrap_or_default().into();
                conteudo.projeto_id = versao["project_id"].as_str().map(str::to_string);
            }
        }
    }
    let ids: std::collections::HashSet<_> = conteudos
        .iter()
        .filter(|c| c.fonte.as_deref() == Some("modrinth"))
        .filter_map(|c| c.projeto_id.clone())
        .collect();
    let ids: Vec<_> = ids.into_iter().collect();
    for lote in ids.chunks(100) {
        let dados = json_remoto(
            cliente
                .get("https://api.modrinth.com/v2/projects")
                .query(&[(
                    "ids",
                    serde_json::to_string(lote).map_err(|e| e.to_string())?,
                )]),
        )
        .await?;
        for projeto in dados.as_array().ok_or("Resposta sem projetos Modrinth.")? {
            for conteudo in conteudos.iter_mut().filter(|c| {
                c.fonte.as_deref() == Some("modrinth")
                    && c.projeto_id.as_deref() == projeto["id"].as_str()
            }) {
                conteudo.nome = projeto["title"].as_str().unwrap_or(&conteudo.nome).into();
                conteudo.icone = projeto["icon_url"].as_str().map(str::to_string);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn listar_conteudos_versao_projeto(
    fonte: String,
    projeto_id: String,
    versao_id: Option<String>,
    tipo_projeto: String,
) -> Result<Vec<ConteudoRelacionado>, String> {
    if !["mod", "modpack", "resourcepack", "shader"].contains(&tipo_projeto.as_str()) {
        return Err("Tipo de projeto inválido.".into());
    }
    let versao_id = match versao_id {
        Some(id) => id,
        None if tipo_projeto != "modpack" => {
            validar_id(&projeto_id)?;
            let cliente = cliente()?;
            let versoes = match fonte.as_str() {
                "modrinth" => {
                    json_remoto(cliente.get(format!(
                        "https://api.modrinth.com/v2/project/{projeto_id}/version"
                    )))
                    .await?
                }
                "curseforge" => {
                    json_remoto(crate::anexar_headers_curseforge(cliente.get(format!(
                        "{}/mods/{projeto_id}/files?pageSize=1&sortField=1&sortOrder=desc",
                        crate::CURSEFORGE_API_BASE
                    )))?)
                    .await?["data"]
                        .clone()
                }
                _ => return Err("Fonte de mod inválida.".into()),
            };
            let id = &versoes[0]["id"];
            id.as_str()
                .map(str::to_string)
                .or_else(|| id.as_u64().map(|id| id.to_string()))
                .ok_or("O projeto não possui versões publicadas.")?
        }
        None => return Err("Selecione a versão do modpack.".into()),
    };
    let versao = versao_remota(&fonte, &projeto_id, &versao_id).await?;
    if tipo_projeto != "modpack" {
        let dependencias = versao["dependencies"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if fonte == "curseforge" {
            let referencias: Vec<_> = dependencias
                .iter()
                .filter(|d| d["relationType"] == 3 || d["relationType"] == 2)
                .filter_map(|d| d["modId"].as_u64().map(|id| (id, None)))
                .collect();
            let mut conteudos = conteudos_curseforge(&referencias, false).await?;
            for conteudo in &mut conteudos {
                conteudo.obrigatoria = conteudo
                    .projeto_id
                    .as_deref()
                    .and_then(|id| {
                        dependencias.iter().find(|d| {
                            d["modId"]
                                .as_u64()
                                .is_some_and(|valor| valor.to_string() == id)
                        })
                    })
                    .map(|d| d["relationType"] == 3);
            }
            return Ok(conteudos);
        }
        let mut conteudos = Vec::new();
        for dependencia in dependencias
            .iter()
            .filter(|d| d["dependency_type"] == "required" || d["dependency_type"] == "optional")
        {
            conteudos.push(dependencia_modrinth(dependencia).await?);
        }
        return Ok(conteudos);
    }
    let bytes = baixar_pacote(&fonte, &projeto_id, &versao).await?;
    let (mut conteudos, referencias) = tauri::async_runtime::spawn_blocking(move || {
        let mut conteudos = Vec::new();
        let mut referencias = Vec::new();
        let mut prefixo_overrides = "overrides/".to_string();
        let mut zip = zip::ZipArchive::new(Cursor::new(&bytes)).map_err(|e| e.to_string())?;
        if fonte == "curseforge" {
            let manifesto = ler_manifesto(&bytes, "manifest.json")?;
            if let Some(pasta) = manifesto["overrides"].as_str() {
                prefixo_overrides = format!("{}/", pasta.trim_matches('/'));
            }
            for arquivo in manifesto["files"]
                .as_array()
                .ok_or("Manifesto sem arquivos.")?
            {
                if let (Some(projeto), Some(versao)) =
                    (arquivo["projectID"].as_u64(), arquivo["fileID"].as_u64())
                {
                    referencias.push((projeto, Some(versao)));
                }
            }
        } else if fonte == "modrinth" {
            let manifesto = ler_manifesto(&bytes, "modrinth.index.json")?;
            for arquivo in manifesto["files"]
                .as_array()
                .ok_or("Índice sem arquivos.")?
            {
                if arquivo["env"]["client"] == "unsupported" {
                    continue;
                }
                if let Some(caminho) = arquivo["path"].as_str().filter(|p| p.starts_with("mods/")) {
                    let mut conteudo = conteudo_arquivo(caminho);
                    identificar_referencia(&mut conteudo, arquivo);
                    conteudos.push(conteudo);
                }
            }
        } else {
            let manifesto = ler_manifesto(&bytes, "dome_manifest.json")?;
            for arquivo in manifesto["arquivos"].as_array().into_iter().flatten() {
                if let Some(caminho) = arquivo["caminho"]
                    .as_str()
                    .filter(|p| p.starts_with("mods/"))
                {
                    let mut conteudo = conteudo_arquivo(caminho);
                    identificar_referencia(&mut conteudo, &arquivo["referencia"]);
                    conteudos.push(conteudo);
                }
            }
        }
        for indice in 0..zip.len() {
            let arquivo = zip.by_index(indice).map_err(|e| e.to_string())?;
            let nome = arquivo.name();
            let nome_minusculo = nome.to_ascii_lowercase();
            if arquivo.is_dir()
                || !(nome_minusculo.ends_with(".jar") || nome_minusculo.ends_with(".jar.disabled"))
            {
                continue;
            }
            let relativo = nome
                .strip_prefix(&prefixo_overrides)
                .or_else(|| nome.strip_prefix("client-overrides/"))
                .unwrap_or(nome);
            if relativo.starts_with("mods/") && !conteudos.iter().any(|c| c.arquivo == relativo) {
                conteudos.push(conteudo_arquivo(relativo));
            }
        }
        Ok::<_, String>((conteudos, referencias))
    })
    .await
    .map_err(|e| e.to_string())??;
    if !referencias.is_empty() {
        conteudos.extend(conteudos_curseforge(&referencias, true).await?);
    }
    enriquecer_modrinth(&mut conteudos).await?;
    conteudos.sort_by_key(|c| c.nome.to_lowercase());
    Ok(conteudos)
}

#[cfg(test)]
mod testes_remotos {
    use super::*;

    #[tokio::test]
    #[ignore = "consulta as APIs públicas e baixa manifestos de modpacks; requer rede"]
    async fn consulta_remota_mods_modpacks_e_dependencias() {
        let cliente = cliente().unwrap();
        let versoes =
            json_remoto(cliente.get("https://api.modrinth.com/v2/project/1KVo5zza/version"))
                .await
                .unwrap();
        let id = versoes[0]["id"].as_str().unwrap();
        let mods = listar_conteudos_versao_projeto(
            "modrinth".into(),
            "1KVo5zza".into(),
            Some(id.into()),
            "modpack".into(),
        )
        .await
        .unwrap();
        assert!(!mods.is_empty());
        assert!(mods
            .iter()
            .all(|m| !m.nome.is_empty() && !m.arquivo.is_empty()));
        println!("Modrinth: {} mods consultados no pacote real.", mods.len());
        let versoes = json_remoto(
            crate::anexar_headers_curseforge(cliente.get(format!(
                "{}/mods/285109/files?pageSize=1",
                crate::CURSEFORGE_API_BASE
            )))
            .unwrap(),
        )
        .await
        .unwrap();
        let id = versoes["data"][0]["id"].as_u64().unwrap().to_string();
        let mods = listar_conteudos_versao_projeto(
            "curseforge".into(),
            "285109".into(),
            Some(id),
            "modpack".into(),
        )
        .await
        .unwrap();
        assert!(!mods.is_empty());
        println!(
            "CurseForge: {} mods consultados no pacote real.",
            mods.len()
        );
        for (fonte, projeto) in [("modrinth", "YL57xq9U"), ("curseforge", "280510")] {
            let dependencias =
                listar_conteudos_versao_projeto(fonte.into(), projeto.into(), None, "mod".into())
                    .await
                    .unwrap();
            assert!(!dependencias.is_empty());
            println!(
                "{fonte}: {} dependências obrigatórias consultadas.",
                dependencias.len()
            );
        }
    }
}
