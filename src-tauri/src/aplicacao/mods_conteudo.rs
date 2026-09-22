use super::*;

fn normalizar_loader_para_mods(loader: Option<&str>) -> Option<String> {
    let loader = loader?.trim().to_lowercase();
    match loader.as_str() {
        "vanilla" => None,
        "fabric" | "forge" | "neoforge" | "quilt" => Some(loader),
        _ => Some(loader),
    }
}

fn lista_str_de_json(valor: &serde_json::Value) -> Vec<String> {
    valor
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn loader_compativel(tags: &[String], loader_instancia: &Option<String>) -> bool {
    let loader_instancia = match loader_instancia {
        Some(loader) => loader,
        None => return true,
    };

    if tags.is_empty() {
        return true;
    }

    tags.iter()
        .any(|t| t.eq_ignore_ascii_case(loader_instancia))
}

fn pontuar_tag_minecraft_curseforge(tag: &str, versao_instancia: &str) -> Option<i32> {
    if tag == versao_instancia {
        return Some(300);
    }

    let tag_numerica = tag.chars().all(|c| c.is_ascii_digit() || c == '.');
    if tag_numerica
        && tag.matches('.').count() == 1
        && versao_instancia.starts_with(&format!("{}.", tag))
    {
        return Some(150);
    }

    None
}

fn extrair_tags_arquivo_curseforge(arquivo: &serde_json::Value) -> (Vec<String>, Vec<String>) {
    let game_versions = lista_str_de_json(&arquivo["gameVersions"]);
    let versoes_mc: Vec<String> = game_versions
        .iter()
        .filter(|s| s.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .cloned()
        .collect();

    let tags_loader: Vec<String> = game_versions
        .iter()
        .filter(|s| {
            let s_lower = s.to_lowercase();
            matches!(s_lower.as_str(), "fabric" | "forge" | "neoforge" | "quilt")
        })
        .map(|s| s.to_lowercase())
        .collect();

    (versoes_mc, tags_loader)
}

fn nome_arquivo_valido_curseforge(tipo_conteudo: &str, nome_arquivo: &str) -> bool {
    let nome = nome_arquivo.to_lowercase();
    match tipo_conteudo {
        "mod" => nome.ends_with(".jar"),
        "modpack" | "resourcepack" | "shader" => {
            nome.ends_with(".zip") || nome.ends_with(".jar") || nome.ends_with(".mrpack")
        }
        _ => false,
    }
}

fn pontuar_arquivo_curseforge(
    arquivo: &serde_json::Value,
    tipo_conteudo: &str,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Option<i32> {
    if !arquivo["isAvailable"].as_bool().unwrap_or(true) {
        return None;
    }

    let nome_arquivo = arquivo["fileName"].as_str().unwrap_or("");
    if !nome_arquivo_valido_curseforge(tipo_conteudo, nome_arquivo) {
        return None;
    }
    if !arquivo["downloadUrl"].is_string() {
        return None;
    }

    let (versoes_mc, tags_loader) = extrair_tags_arquivo_curseforge(arquivo);
    let mut score = 0;

    if versoes_mc.is_empty() {
        score += 40;
    } else {
        let melhor_mc = versoes_mc
            .iter()
            .filter_map(|tag| pontuar_tag_minecraft_curseforge(tag, versao_instancia))
            .max()?;
        score += melhor_mc;
    }

    if tipo_conteudo == "mod" {
        if let Some(loader) = loader_instancia {
            if tags_loader.is_empty() {
                score += 40;
            } else if tags_loader
                .iter()
                .any(|tag| tag.eq_ignore_ascii_case(loader))
            {
                score += 200;
            } else {
                return None;
            }
        }
    }

    let file_id = arquivo["id"].as_i64().unwrap_or(0) as i32;
    Some(score.saturating_mul(100_000) + file_id.max(0))
}

fn selecionar_arquivo_curseforge_compativel<'a>(
    arquivos: &'a [serde_json::Value],
    tipo_conteudo: &str,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Option<&'a serde_json::Value> {
    arquivos
        .iter()
        .filter_map(|arquivo| {
            pontuar_arquivo_curseforge(arquivo, tipo_conteudo, versao_instancia, loader_instancia)
                .map(|score| (score, arquivo))
        })
        .max_by_key(|(score, _)| *score)
        .map(|(_, arquivo)| arquivo)
}

#[derive(Debug, Serialize)]
pub(crate) struct ArquivoVersaoProjetoCurseforge {
    url: String,
    filename: String,
    primary: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct VersaoProjetoCurseforge {
    id: String,
    version_number: String,
    version_type: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    date_published: Option<String>,
    files: Vec<ArquivoVersaoProjetoCurseforge>,
}

fn mapear_versao_projeto_curseforge(
    arquivo: &serde_json::Value,
    tipo_projeto: &str,
) -> Option<VersaoProjetoCurseforge> {
    if !arquivo["isAvailable"].as_bool().unwrap_or(true) {
        return None;
    }

    let id = arquivo["id"].as_u64()?.to_string();
    let filename = arquivo["fileName"].as_str().unwrap_or("").trim();
    if !nome_arquivo_valido_curseforge(tipo_projeto, filename) {
        return None;
    }

    let version_number = arquivo["displayName"]
        .as_str()
        .filter(|valor| !valor.trim().is_empty())
        .unwrap_or(filename)
        .to_string();
    let (game_versions, loaders) = extrair_tags_arquivo_curseforge(arquivo);
    let files = arquivo["downloadUrl"]
        .as_str()
        .filter(|url| !url.trim().is_empty())
        .map(|url| {
            vec![ArquivoVersaoProjetoCurseforge {
                url: url.to_string(),
                filename: filename.to_string(),
                primary: true,
            }]
        })
        .unwrap_or_default();

    Some(VersaoProjetoCurseforge {
        id,
        version_number,
        version_type: match arquivo["releaseType"].as_u64() {
            Some(2) => "beta",
            Some(3) => "alpha",
            _ => "release",
        }
        .to_string(),
        game_versions,
        loaders,
        date_published: arquivo["fileDate"].as_str().map(str::to_string),
        files,
    })
}

fn id_loader_curseforge(loader: &str) -> Option<u8> {
    match loader.trim().to_lowercase().as_str() {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

#[tauri::command]
pub(crate) async fn listar_versoes_projeto_curseforge(
    project_id: String,
    game_version: Option<String>,
    loader: Option<String>,
    project_type: Option<String>,
) -> Result<Vec<VersaoProjetoCurseforge>, String> {
    let project_id = project_id
        .trim()
        .parse::<u64>()
        .map_err(|_| "ID de projeto CurseForge inválido.".to_string())?;
    let project_type = project_type
        .as_deref()
        .map(str::trim)
        .filter(|valor| !valor.is_empty())
        .unwrap_or("mod")
        .to_lowercase();
    let mut files_url = format!(
        "{}/mods/{}/files?pageSize=50&sortField=1&sortOrder=desc",
        CURSEFORGE_API_BASE, project_id
    );
    let game_version = game_version
        .as_deref()
        .map(str::trim)
        .filter(|valor| !valor.is_empty());
    if let Some(game_version) = game_version {
        files_url.push_str(&format!(
            "&gameVersion={}",
            urlencoding::encode(game_version)
        ));
        if let Some(loader_id) = loader.as_deref().and_then(id_loader_curseforge) {
            files_url.push_str(&format!("&modLoaderType={}", loader_id));
        }
    }
    let client = reqwest::Client::new();
    let request = anexar_headers_curseforge(client.get(&files_url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar versões do CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao listar versões: {}",
            resposta.status()
        ));
    }

    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao interpretar versões do CurseForge: {}", e))?;
    let arquivos = payload["data"]
        .as_array()
        .ok_or("Resposta do CurseForge sem lista de versões.")?;

    Ok(arquivos
        .iter()
        .filter_map(|arquivo| mapear_versao_projeto_curseforge(arquivo, &project_type))
        .collect())
}

#[tauri::command]
pub(crate) async fn obter_versao_projeto_curseforge(
    project_id: String,
    file_id: String,
    project_type: Option<String>,
) -> Result<VersaoProjetoCurseforge, String> {
    let project_id = project_id
        .trim()
        .parse::<u64>()
        .map_err(|_| "ID de projeto CurseForge inválido.".to_string())?;
    let file_id = file_id
        .trim()
        .parse::<u64>()
        .map_err(|_| "ID de arquivo CurseForge inválido.".to_string())?;
    let project_type = project_type
        .as_deref()
        .unwrap_or("modpack")
        .trim()
        .to_lowercase();
    let url = format!(
        "{}/mods/{}/files/{}",
        CURSEFORGE_API_BASE, project_id, file_id
    );
    let request = anexar_headers_curseforge(reqwest::Client::new().get(&url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar versão do CurseForge: {}", e))?;
    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao buscar versão: {}",
            resposta.status()
        ));
    }
    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao interpretar versão do CurseForge: {}", e))?;
    mapear_versao_projeto_curseforge(&payload["data"], &project_type)
        .ok_or_else(|| "Versão do CurseForge sem arquivo instalável.".to_string())
}

fn versao_modrinth_compativel(
    versao: &serde_json::Value,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> bool {
    let versoes_mc = lista_str_de_json(&versao["game_versions"]);
    let loaders = lista_str_de_json(&versao["loaders"]);

    let versao_exata = versoes_mc.is_empty()
        || versoes_mc
            .iter()
            .any(|versao_mc| versao_mc == versao_instancia);

    versao_exata && loader_compativel(&loaders, loader_instancia)
}

#[derive(Clone)]
enum ReferenciaModObrigatorio {
    Modrinth {
        project_id: Option<String>,
        version_id: Option<String>,
    },
    CurseForge {
        project_id: String,
        file_id: Option<String>,
    },
}

impl ReferenciaModObrigatorio {
    fn chave(&self) -> String {
        match self {
            Self::Modrinth {
                project_id: Some(project_id),
                ..
            } => format!("modrinth:project:{}", project_id),
            Self::Modrinth {
                version_id: Some(version_id),
                ..
            } => format!("modrinth:version:{}", version_id),
            Self::Modrinth { .. } => "modrinth:invalido".to_string(),
            Self::CurseForge { project_id, .. } => format!("curseforge:project:{}", project_id),
        }
    }
}

struct ArquivoModResolvido {
    chave: String,
    project_id: String,
    nome_versao: String,
    icone_url: Option<String>,
    versao: String,
    tipo_versao: String,
    plataforma: ModPlatform,
    download_url: String,
    file_name: String,
    dependencias: Vec<ReferenciaModObrigatorio>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelecaoInstalacaoConteudo {
    id: String,
    nome: String,
    icone_url: Option<String>,
    plataforma: ModPlatform,
    tipo_projeto: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ItemPlanoInstalacaoConteudo {
    chave: String,
    project_id: String,
    nome: String,
    icone_url: Option<String>,
    nome_arquivo: String,
    versao: String,
    tipo_versao: String,
    plataforma: ModPlatform,
    tipo_projeto: String,
    requerido_por: Vec<String>,
    selecionado: bool,
}

enum EtapaPlanoInstalacao {
    Resolver {
        referencia: ReferenciaModObrigatorio,
        requerido_por: Option<String>,
    },
    Adicionar {
        arquivo: ArquivoModResolvido,
        requerido_por: Option<String>,
    },
}

enum EtapaResolucaoMod {
    Resolver(ReferenciaModObrigatorio),
    AgendarDownload(ArquivoModResolvido),
}

struct MetadadosProjetoConteudo {
    nome: String,
    icone_url: Option<String>,
}

async fn buscar_metadados_projeto_modrinth(
    client: &reqwest::Client,
    project_id: &str,
) -> Result<MetadadosProjetoConteudo, String> {
    let url = format!(
        "{}/project/{}",
        MODRINTH_API_BASE,
        urlencoding::encode(project_id)
    );
    let resposta = client
        .get(url)
        .header("User-Agent", "DomeLauncher/1.0")
        .send()
        .await
        .map_err(|e| {
            format!(
                "Erro ao buscar os dados do projeto Modrinth {}: {}",
                project_id, e
            )
        })?;
    if !resposta.status().is_success() {
        return Err(format!(
            "Modrinth retornou {} ao buscar os dados do projeto {}.",
            resposta.status(),
            project_id
        ));
    }

    let projeto = resposta.json::<serde_json::Value>().await.map_err(|e| {
        format!(
            "Erro ao interpretar o projeto Modrinth {}: {}",
            project_id, e
        )
    })?;
    let nome = projeto["title"]
        .as_str()
        .filter(|valor| !valor.trim().is_empty())
        .ok_or_else(|| format!("O projeto Modrinth {} não informou um nome.", project_id))?;

    Ok(MetadadosProjetoConteudo {
        nome: nome.to_string(),
        icone_url: projeto["icon_url"].as_str().map(str::to_string),
    })
}

async fn buscar_metadados_projeto_curseforge(
    client: &reqwest::Client,
    project_id: &str,
) -> Result<MetadadosProjetoConteudo, String> {
    let url = format!("{}/mods/{}", CURSEFORGE_API_BASE, project_id);
    let resposta = anexar_headers_curseforge(client.get(url))?
        .send()
        .await
        .map_err(|e| {
            format!(
                "Erro ao buscar os dados do projeto CurseForge {}: {}",
                project_id, e
            )
        })?;
    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou {} ao buscar os dados do projeto {}.",
            resposta.status(),
            project_id
        ));
    }

    let payload = resposta.json::<serde_json::Value>().await.map_err(|e| {
        format!(
            "Erro ao interpretar o projeto CurseForge {}: {}",
            project_id, e
        )
    })?;
    let projeto = &payload["data"];
    let nome = projeto["name"]
        .as_str()
        .filter(|valor| !valor.trim().is_empty())
        .ok_or_else(|| format!("O projeto CurseForge {} não informou um nome.", project_id))?;

    Ok(MetadadosProjetoConteudo {
        nome: nome.to_string(),
        icone_url: projeto["logo"]["url"].as_str().map(str::to_string),
    })
}

fn arquivo_jar_modrinth(versao: &serde_json::Value) -> Option<(String, String)> {
    let arquivos = versao["files"].as_array()?;
    let arquivo = arquivos
        .iter()
        .find(|arquivo| {
            arquivo["primary"].as_bool().unwrap_or(false)
                && arquivo["filename"]
                    .as_str()
                    .is_some_and(|nome| nome.to_lowercase().ends_with(".jar"))
        })
        .or_else(|| {
            arquivos.iter().find(|arquivo| {
                arquivo["filename"]
                    .as_str()
                    .is_some_and(|nome| nome.to_lowercase().ends_with(".jar"))
            })
        })?;

    Some((
        arquivo["url"].as_str()?.to_string(),
        arquivo["filename"].as_str()?.to_string(),
    ))
}

async fn resolver_modrinth_obrigatorio(
    client: &reqwest::Client,
    referencia: &ReferenciaModObrigatorio,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Result<ArquivoModResolvido, String> {
    let (project_id, version_id) = match referencia {
        ReferenciaModObrigatorio::Modrinth {
            project_id,
            version_id,
        } => (project_id.as_deref(), version_id.as_deref()),
        _ => return Err("Referência Modrinth inválida.".to_string()),
    };

    let versao = if let Some(version_id) = version_id {
        let url = format!(
            "{}/version/{}",
            MODRINTH_API_BASE,
            urlencoding::encode(version_id)
        );
        let resposta = client
            .get(url)
            .header("User-Agent", "DomeLauncher/1.0")
            .send()
            .await
            .map_err(|e| format!("Erro ao buscar dependência Modrinth: {}", e))?;
        if !resposta.status().is_success() {
            return Err(format!(
                "Modrinth retornou {} ao buscar a versão obrigatória {}.",
                resposta.status(),
                version_id
            ));
        }
        resposta
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Erro ao interpretar dependência Modrinth: {}", e))?
    } else {
        let project_id = project_id
            .ok_or("Uma dependência obrigatória do Modrinth não informa projeto nem versão.")?;
        let game_versions =
            urlencoding::encode(&serde_json::json!([versao_instancia]).to_string()).to_string();
        let mut url = format!(
            "{}/project/{}/version?game_versions={}",
            MODRINTH_API_BASE,
            urlencoding::encode(project_id),
            game_versions
        );
        if let Some(loader) = loader_instancia {
            let loaders = urlencoding::encode(&serde_json::json!([loader]).to_string()).to_string();
            url.push_str(&format!("&loaders={}", loaders));
        }
        let resposta = client
            .get(url)
            .header("User-Agent", "DomeLauncher/1.0")
            .send()
            .await
            .map_err(|e| format!("Erro ao resolver dependência Modrinth: {}", e))?;
        if !resposta.status().is_success() {
            return Err(format!(
                "Modrinth retornou {} ao resolver a dependência {}.",
                resposta.status(),
                project_id
            ));
        }
        resposta
            .json::<Vec<serde_json::Value>>()
            .await
            .map_err(|e| format!("Erro ao interpretar versões da dependência: {}", e))?
            .into_iter()
            .find(|item| versao_modrinth_compativel(item, versao_instancia, loader_instancia))
            .ok_or_else(|| {
                format!(
                    "A dependência obrigatória {} não possui versão para MC {} e loader {:?}.",
                    project_id, versao_instancia, loader_instancia
                )
            })?
    };

    if !versao_modrinth_compativel(&versao, versao_instancia, loader_instancia) {
        return Err(format!(
            "A dependência obrigatória Modrinth {} não é compatível com MC {} e loader {:?}.",
            version_id.or(project_id).unwrap_or("desconhecida"),
            versao_instancia,
            loader_instancia
        ));
    }

    let project_id_resolvido = versao["project_id"]
        .as_str()
        .or(project_id)
        .ok_or("Versão Modrinth sem identificação do projeto.")?;
    let metadados = buscar_metadados_projeto_modrinth(client, project_id_resolvido).await?;
    let (download_url, file_name) = arquivo_jar_modrinth(&versao)
        .ok_or("Dependência Modrinth compatível sem arquivo JAR válido.")?;
    let mut dependencias = Vec::new();
    if let Some(itens) = versao["dependencies"].as_array() {
        for item in itens {
            if item["dependency_type"].as_str() != Some("required") {
                continue;
            }
            let project_id = item["project_id"].as_str().map(str::to_string);
            let version_id = item["version_id"].as_str().map(str::to_string);
            if project_id.is_none() && version_id.is_none() {
                return Err(format!(
                    "O mod {} possui uma dependência obrigatória externa que não pode ser resolvida automaticamente.",
                    project_id_resolvido
                ));
            }
            dependencias.push(ReferenciaModObrigatorio::Modrinth {
                project_id,
                version_id,
            });
        }
    }

    Ok(ArquivoModResolvido {
        chave: format!("modrinth:project:{}", project_id_resolvido),
        project_id: project_id_resolvido.to_string(),
        nome_versao: metadados.nome,
        icone_url: metadados.icone_url,
        versao: versao["version_number"]
            .as_str()
            .unwrap_or("Versão compatível")
            .to_string(),
        tipo_versao: versao["version_type"]
            .as_str()
            .unwrap_or("release")
            .to_string(),
        plataforma: ModPlatform::Modrinth,
        download_url,
        file_name,
        dependencias,
    })
}

async fn resolver_curseforge_obrigatorio(
    client: &reqwest::Client,
    referencia: &ReferenciaModObrigatorio,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Result<ArquivoModResolvido, String> {
    let (project_id, file_id) = match referencia {
        ReferenciaModObrigatorio::CurseForge {
            project_id,
            file_id,
        } => (project_id, file_id.as_deref()),
        _ => return Err("Referência CurseForge inválida.".to_string()),
    };

    let arquivo = if let Some(file_id) = file_id {
        let url = format!(
            "{}/mods/{}/files/{}",
            CURSEFORGE_API_BASE, project_id, file_id
        );
        let resposta = anexar_headers_curseforge(client.get(url))?
            .send()
            .await
            .map_err(|e| format!("Erro ao buscar dependência CurseForge: {}", e))?;
        if !resposta.status().is_success() {
            return Err(format!(
                "CurseForge retornou {} ao buscar o arquivo obrigatório {}.",
                resposta.status(),
                file_id
            ));
        }
        resposta
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Erro ao interpretar dependência CurseForge: {}", e))?["data"]
            .clone()
    } else {
        let mut url = format!(
            "{}/mods/{}/files?gameVersion={}&pageSize=50&sortField=1&sortOrder=desc",
            CURSEFORGE_API_BASE,
            project_id,
            urlencoding::encode(versao_instancia)
        );
        if let Some(loader_id) = loader_instancia.as_deref().and_then(id_loader_curseforge) {
            url.push_str(&format!("&modLoaderType={}", loader_id));
        }
        let resposta = anexar_headers_curseforge(client.get(url))?
            .send()
            .await
            .map_err(|e| format!("Erro ao resolver dependência CurseForge: {}", e))?;
        if !resposta.status().is_success() {
            return Err(format!(
                "CurseForge retornou {} ao resolver a dependência {}.",
                resposta.status(),
                project_id
            ));
        }
        let payload = resposta
            .json::<serde_json::Value>()
            .await
            .map_err(|e| format!("Erro ao interpretar arquivos da dependência: {}", e))?;
        let arquivos = payload["data"]
            .as_array()
            .ok_or("CurseForge não retornou arquivos para a dependência.")?;
        selecionar_arquivo_curseforge_compativel(
            arquivos,
            "mod",
            versao_instancia,
            loader_instancia,
        )
        .cloned()
        .ok_or_else(|| {
            format!(
                "A dependência obrigatória {} não possui arquivo para MC {} e loader {:?}.",
                project_id, versao_instancia, loader_instancia
            )
        })?
    };

    if pontuar_arquivo_curseforge(&arquivo, "mod", versao_instancia, loader_instancia).is_none() {
        return Err(format!(
            "A dependência obrigatória CurseForge {} não é compatível com MC {} e loader {:?}.",
            project_id, versao_instancia, loader_instancia
        ));
    }

    let download_url = arquivo["downloadUrl"]
        .as_str()
        .ok_or("Dependência CurseForge compatível sem URL de download.")?
        .to_string();
    let file_name = arquivo["fileName"]
        .as_str()
        .ok_or("Dependência CurseForge sem nome de arquivo.")?
        .to_string();
    let metadados = buscar_metadados_projeto_curseforge(client, project_id).await?;
    let mut dependencias = Vec::new();
    if let Some(itens) = arquivo["dependencies"].as_array() {
        for item in itens {
            if item["relationType"].as_u64() != Some(3) {
                continue;
            }
            let mod_id = item["modId"]
                .as_u64()
                .filter(|id| *id > 0)
                .ok_or("Dependência obrigatória CurseForge sem modId válido.")?;
            let file_id = item["fileId"]
                .as_u64()
                .filter(|id| *id > 0)
                .map(|id| id.to_string());
            dependencias.push(ReferenciaModObrigatorio::CurseForge {
                project_id: mod_id.to_string(),
                file_id,
            });
        }
    }

    Ok(ArquivoModResolvido {
        chave: format!("curseforge:project:{}", project_id),
        project_id: project_id.to_string(),
        nome_versao: metadados.nome,
        icone_url: metadados.icone_url,
        versao: arquivo["displayName"]
            .as_str()
            .unwrap_or("Versão compatível")
            .to_string(),
        tipo_versao: rotulo_tipo_versao_curseforge(&arquivo).to_string(),
        plataforma: ModPlatform::CurseForge,
        download_url,
        file_name,
        dependencias,
    })
}

async fn resolver_arquivo_mod_obrigatorio(
    client: &reqwest::Client,
    referencia: &ReferenciaModObrigatorio,
    versao_instancia: &str,
    loader_instancia: &Option<String>,
) -> Result<ArquivoModResolvido, String> {
    match referencia {
        ReferenciaModObrigatorio::Modrinth { .. } => {
            resolver_modrinth_obrigatorio(client, referencia, versao_instancia, loader_instancia)
                .await
        }
        ReferenciaModObrigatorio::CurseForge { .. } => {
            resolver_curseforge_obrigatorio(client, referencia, versao_instancia, loader_instancia)
                .await
        }
    }
}

fn rotulo_tipo_versao_curseforge(arquivo: &serde_json::Value) -> &'static str {
    match arquivo["releaseType"].as_u64() {
        Some(2) => "beta",
        Some(3) => "alpha",
        _ => "release",
    }
}

fn arquivo_projeto_modrinth<'a>(
    versao: &'a serde_json::Value,
    tipo_projeto: &str,
) -> Option<&'a serde_json::Value> {
    let arquivos = versao["files"].as_array()?;
    arquivos
        .iter()
        .find(|arquivo| {
            arquivo["primary"].as_bool().unwrap_or(false)
                && arquivo["filename"]
                    .as_str()
                    .is_some_and(|nome| nome_arquivo_valido_curseforge(tipo_projeto, nome))
        })
        .or_else(|| {
            arquivos.iter().find(|arquivo| {
                arquivo["filename"]
                    .as_str()
                    .is_some_and(|nome| nome_arquivo_valido_curseforge(tipo_projeto, nome))
            })
        })
}

async fn resolver_projeto_sem_dependencias(
    client: &reqwest::Client,
    selecao: &SelecaoInstalacaoConteudo,
    versao_minecraft: &str,
    loader: &Option<String>,
) -> Result<ArquivoModResolvido, String> {
    match selecao.plataforma {
        ModPlatform::Modrinth => {
            let game_versions =
                urlencoding::encode(&serde_json::json!([versao_minecraft]).to_string()).to_string();
            let mut url = format!(
                "{}/project/{}/version?game_versions={}",
                MODRINTH_API_BASE,
                urlencoding::encode(&selecao.id),
                game_versions
            );
            if selecao.tipo_projeto == "mod" {
                if let Some(loader) = loader {
                    let loaders =
                        urlencoding::encode(&serde_json::json!([loader]).to_string()).to_string();
                    url.push_str(&format!("&loaders={}", loaders));
                }
            }

            let resposta = client
                .get(url)
                .header("User-Agent", "DomeLauncher/1.0")
                .send()
                .await
                .map_err(|e| format!("Erro ao preparar {}: {}", selecao.nome, e))?;
            if !resposta.status().is_success() {
                return Err(format!(
                    "Modrinth retornou HTTP {} ao preparar {}.",
                    resposta.status().as_u16(),
                    selecao.nome
                ));
            }

            let versoes = resposta
                .json::<Vec<serde_json::Value>>()
                .await
                .map_err(|e| format!("Erro ao interpretar versões de {}: {}", selecao.nome, e))?;
            let versao = versoes
                .iter()
                .find(|item| {
                    versao_modrinth_compativel(
                        item,
                        versao_minecraft,
                        if selecao.tipo_projeto == "mod" {
                            loader
                        } else {
                            &None
                        },
                    )
                })
                .ok_or_else(|| {
                    format!(
                        "{} não possui versão compatível com Minecraft {}.",
                        selecao.nome, versao_minecraft
                    )
                })?;
            let arquivo = arquivo_projeto_modrinth(versao, &selecao.tipo_projeto)
                .ok_or_else(|| format!("{} não possui arquivo compatível.", selecao.nome))?;
            let file_name = arquivo["filename"]
                .as_str()
                .ok_or_else(|| format!("{} retornou um arquivo sem nome.", selecao.nome))?
                .to_string();
            let download_url = arquivo["url"]
                .as_str()
                .ok_or_else(|| format!("{} retornou um arquivo sem URL.", selecao.nome))?
                .to_string();

            Ok(ArquivoModResolvido {
                chave: format!("modrinth:project:{}", selecao.id),
                project_id: selecao.id.clone(),
                nome_versao: selecao.nome.clone(),
                icone_url: selecao.icone_url.clone(),
                versao: versao["version_number"]
                    .as_str()
                    .unwrap_or("Versão compatível")
                    .to_string(),
                tipo_versao: versao["version_type"]
                    .as_str()
                    .unwrap_or("release")
                    .to_string(),
                plataforma: ModPlatform::Modrinth,
                download_url,
                file_name,
                dependencias: Vec::new(),
            })
        }
        ModPlatform::CurseForge => {
            let mut url = format!(
                "{}/mods/{}/files?gameVersion={}&pageSize=50&sortField=1&sortOrder=desc",
                CURSEFORGE_API_BASE,
                urlencoding::encode(&selecao.id),
                urlencoding::encode(versao_minecraft)
            );
            if selecao.tipo_projeto == "mod" {
                if let Some(loader_id) = loader.as_deref().and_then(id_loader_curseforge) {
                    url.push_str(&format!("&modLoaderType={}", loader_id));
                }
            }
            let resposta = anexar_headers_curseforge(client.get(url))?
                .send()
                .await
                .map_err(|e| format!("Erro ao preparar {}: {}", selecao.nome, e))?;
            if !resposta.status().is_success() {
                return Err(format!(
                    "CurseForge retornou HTTP {} ao preparar {}.",
                    resposta.status().as_u16(),
                    selecao.nome
                ));
            }
            let payload = resposta
                .json::<serde_json::Value>()
                .await
                .map_err(|e| format!("Erro ao interpretar arquivos de {}: {}", selecao.nome, e))?;
            let arquivos = payload["data"]
                .as_array()
                .ok_or("CurseForge não retornou uma lista de arquivos.")?;
            let arquivo = selecionar_arquivo_curseforge_compativel(
                arquivos,
                &selecao.tipo_projeto,
                versao_minecraft,
                loader,
            )
            .ok_or_else(|| {
                format!(
                    "{} não possui arquivo compatível com Minecraft {}.",
                    selecao.nome, versao_minecraft
                )
            })?;
            let file_name = arquivo["fileName"]
                .as_str()
                .ok_or_else(|| format!("{} retornou um arquivo sem nome.", selecao.nome))?
                .to_string();
            let download_url = arquivo["downloadUrl"]
                .as_str()
                .ok_or_else(|| format!("{} retornou um arquivo sem URL.", selecao.nome))?
                .to_string();

            Ok(ArquivoModResolvido {
                chave: format!("curseforge:project:{}", selecao.id),
                project_id: selecao.id.clone(),
                nome_versao: selecao.nome.clone(),
                icone_url: selecao.icone_url.clone(),
                versao: arquivo["displayName"]
                    .as_str()
                    .unwrap_or("Versão compatível")
                    .to_string(),
                tipo_versao: rotulo_tipo_versao_curseforge(arquivo).to_string(),
                plataforma: ModPlatform::CurseForge,
                download_url,
                file_name,
                dependencias: Vec::new(),
            })
        }
        ModPlatform::Ftb => Err("A instalação em lote não oferece suporte ao FTB.".to_string()),
    }
}

fn adicionar_item_ao_plano(
    plano: &mut Vec<ItemPlanoInstalacaoConteudo>,
    arquivo: ArquivoModResolvido,
    tipo_projeto: &str,
    nome_selecionado: Option<&str>,
    icone_selecionado: Option<&str>,
    requerido_por: Option<String>,
) {
    if let Some(existente) = plano.iter_mut().find(|item| item.chave == arquivo.chave) {
        if let Some(nome) = nome_selecionado {
            existente.nome = nome.to_string();
            existente.selecionado = true;
        }
        if let Some(icone_url) = icone_selecionado {
            existente.icone_url = Some(icone_url.to_string());
        } else if existente.icone_url.is_none() {
            existente.icone_url = arquivo.icone_url;
        }
        if let Some(requerente) = requerido_por {
            if !existente.requerido_por.contains(&requerente) {
                existente.requerido_por.push(requerente);
            }
        }
        return;
    }

    plano.push(ItemPlanoInstalacaoConteudo {
        chave: arquivo.chave,
        project_id: arquivo.project_id,
        nome: nome_selecionado.unwrap_or(&arquivo.nome_versao).to_string(),
        icone_url: icone_selecionado.map(str::to_string).or(arquivo.icone_url),
        nome_arquivo: arquivo.file_name,
        versao: arquivo.versao,
        tipo_versao: arquivo.tipo_versao,
        plataforma: arquivo.plataforma,
        tipo_projeto: tipo_projeto.to_string(),
        requerido_por: requerido_por.into_iter().collect(),
        selecionado: nome_selecionado.is_some(),
    });
}

async fn adicionar_mod_e_dependencias_ao_plano(
    client: &reqwest::Client,
    plano: &mut Vec<ItemPlanoInstalacaoConteudo>,
    selecao: &SelecaoInstalacaoConteudo,
    versao_minecraft: &str,
    loader: &Option<String>,
) -> Result<(), String> {
    let referencia_principal = match selecao.plataforma {
        ModPlatform::Modrinth => ReferenciaModObrigatorio::Modrinth {
            project_id: Some(selecao.id.clone()),
            version_id: None,
        },
        ModPlatform::CurseForge => ReferenciaModObrigatorio::CurseForge {
            project_id: selecao.id.clone(),
            file_id: None,
        },
        ModPlatform::Ftb => {
            return Err("A instalação em lote não oferece suporte ao FTB.".to_string())
        }
    };
    let mut etapas = vec![EtapaPlanoInstalacao::Resolver {
        referencia: referencia_principal,
        requerido_por: None,
    }];
    let mut visitados = std::collections::HashSet::new();

    while let Some(etapa) = etapas.pop() {
        match etapa {
            EtapaPlanoInstalacao::Resolver {
                referencia,
                requerido_por,
            } => {
                if !visitados.insert(referencia.chave()) {
                    continue;
                }
                let resolvido =
                    resolver_arquivo_mod_obrigatorio(client, &referencia, versao_minecraft, loader)
                        .await?;
                let nome_requerente = if requerido_por.is_none() {
                    selecao.nome.clone()
                } else {
                    resolvido.nome_versao.clone()
                };
                let dependencias = resolvido.dependencias.clone();
                etapas.push(EtapaPlanoInstalacao::Adicionar {
                    arquivo: resolvido,
                    requerido_por,
                });
                for dependencia in dependencias.into_iter().rev() {
                    etapas.push(EtapaPlanoInstalacao::Resolver {
                        referencia: dependencia,
                        requerido_por: Some(nome_requerente.clone()),
                    });
                }
            }
            EtapaPlanoInstalacao::Adicionar {
                arquivo,
                requerido_por,
            } => {
                let principal = requerido_por.is_none();
                adicionar_item_ao_plano(
                    plano,
                    arquivo,
                    "mod",
                    principal.then_some(selecao.nome.as_str()),
                    principal.then_some(selecao.icone_url.as_deref()).flatten(),
                    requerido_por,
                );
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn planejar_instalacao_conteudo(
    instance_id: String,
    itens: Vec<SelecaoInstalacaoConteudo>,
    state: State<'_, LauncherState>,
) -> Result<Vec<ItemPlanoInstalacaoConteudo>, String> {
    if itens.is_empty() {
        return Err("Selecione ao menos um conteúdo para revisar.".to_string());
    }
    if itens.len() > 50 {
        return Err("Selecione no máximo 50 conteúdos por vez.".to_string());
    }

    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let versao_minecraft = instancia.version.clone();
    let loader = normalizar_loader_para_mods(instancia.loader_type.as_deref());
    let client = reqwest::Client::new();
    let mut plano = Vec::new();

    for selecao in itens {
        if !matches!(
            selecao.tipo_projeto.as_str(),
            "mod" | "resourcepack" | "shader"
        ) {
            return Err(format!(
                "Tipo de conteúdo inválido: {}.",
                selecao.tipo_projeto
            ));
        }
        if selecao.id.trim().is_empty() || selecao.nome.trim().is_empty() {
            return Err("Um conteúdo selecionado não possui identificação válida.".to_string());
        }

        if selecao.tipo_projeto == "mod" {
            adicionar_mod_e_dependencias_ao_plano(
                &client,
                &mut plano,
                &selecao,
                &versao_minecraft,
                &loader,
            )
            .await?;
            continue;
        }

        let arquivo =
            resolver_projeto_sem_dependencias(&client, &selecao, &versao_minecraft, &loader)
                .await?;
        adicionar_item_ao_plano(
            &mut plano,
            arquivo,
            &selecao.tipo_projeto,
            Some(&selecao.nome),
            selecao.icone_url.as_deref(),
            None,
        );
    }

    Ok(plano)
}

#[cfg(test)]
mod testes_plano_instalacao_conteudo {
    use super::*;

    fn arquivo_teste(chave: &str, nome: &str) -> ArquivoModResolvido {
        ArquivoModResolvido {
            chave: chave.to_string(),
            project_id: chave.to_string(),
            nome_versao: nome.to_string(),
            icone_url: Some(format!(
                "https://cdn.modrinth.com/data/{}.png",
                nome.to_lowercase()
            )),
            versao: "1.0.0".to_string(),
            tipo_versao: "release".to_string(),
            plataforma: ModPlatform::Modrinth,
            download_url: "https://cdn.modrinth.com/data/teste.jar".to_string(),
            file_name: format!("{}.jar", nome.to_lowercase()),
            dependencias: Vec::new(),
        }
    }

    #[test]
    fn dependencia_duplicada_vira_selecao_sem_perder_requerentes() {
        let mut plano = Vec::new();
        adicionar_item_ao_plano(
            &mut plano,
            arquivo_teste("modrinth:project:biblioteca", "Biblioteca"),
            "mod",
            None,
            None,
            Some("Mod principal".to_string()),
        );
        adicionar_item_ao_plano(
            &mut plano,
            arquivo_teste("modrinth:project:biblioteca", "Biblioteca"),
            "mod",
            Some("Biblioteca escolhida"),
            Some("https://cdn.modrinth.com/data/biblioteca-escolhida.png"),
            None,
        );

        assert_eq!(plano.len(), 1);
        assert!(plano[0].selecionado);
        assert_eq!(plano[0].nome, "Biblioteca escolhida");
        assert_eq!(
            plano[0].icone_url.as_deref(),
            Some("https://cdn.modrinth.com/data/biblioteca-escolhida.png")
        );
        assert_eq!(plano[0].requerido_por, vec!["Mod principal"]);
    }

    #[test]
    fn dependencia_compartilhada_permanece_como_um_unico_download() {
        let mut plano = Vec::new();
        for requerente in ["Mod A", "Mod B"] {
            adicionar_item_ao_plano(
                &mut plano,
                arquivo_teste("modrinth:project:biblioteca", "Biblioteca comum"),
                "mod",
                None,
                None,
                Some(requerente.to_string()),
            );
        }

        assert_eq!(plano.len(), 1);
        assert!(!plano[0].selecionado);
        assert_eq!(plano[0].requerido_por, vec!["Mod A", "Mod B"]);
    }
}

fn nome_arquivo_mod_seguro(file_name: &str) -> Result<String, String> {
    let nome = std::path::Path::new(file_name)
        .file_name()
        .and_then(|nome| nome.to_str())
        .filter(|nome| !nome.trim().is_empty() && nome.to_lowercase().ends_with(".jar"))
        .ok_or("Nome de arquivo de mod inválido.")?;
    Ok(nome.to_string())
}

async fn baixar_e_instalar_arquivos_mod(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
    arquivos: Vec<ArquivoModResolvido>,
) -> Result<(), String> {
    let arquivos = arquivos
        .into_iter()
        .map(|arquivo| {
            nome_arquivo_mod_seguro(&arquivo.file_name).map(|nome| (arquivo.download_url, nome))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let pasta_temporaria = mods_dir.join(format!(".dome-install-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&pasta_temporaria)
        .map_err(|e| format!("Erro ao preparar instalação dos mods: {}", e))?;
    let mut temporarios = Vec::new();
    let mut nomes_agendados = std::collections::HashSet::new();

    for (indice, (download_url, nome)) in arquivos.into_iter().enumerate() {
        if !nomes_agendados.insert(nome.to_lowercase()) || mods_dir.join(&nome).exists() {
            continue;
        }
        let resposta = match client.get(&download_url).send().await {
            Ok(resposta) => resposta,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&pasta_temporaria);
                return Err(format!("Erro ao baixar {}: {}", nome, e));
            }
        };
        if !resposta.status().is_success() {
            let status = resposta.status();
            let _ = std::fs::remove_dir_all(&pasta_temporaria);
            return Err(format!("Download de {} retornou HTTP {}.", nome, status));
        }
        let bytes = match resposta.bytes().await {
            Ok(bytes) => bytes,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&pasta_temporaria);
                return Err(format!("Erro ao receber {}: {}", nome, e));
            }
        };
        let caminho_temporario = pasta_temporaria.join(format!("{}-{}", indice, nome));
        if let Err(e) = std::fs::write(&caminho_temporario, bytes) {
            let _ = std::fs::remove_dir_all(&pasta_temporaria);
            return Err(format!("Erro ao preparar {}: {}", nome, e));
        }
        temporarios.push((caminho_temporario, mods_dir.join(nome)));
    }

    let mut instalados = Vec::new();
    for (temporario, destino) in temporarios {
        if let Err(e) = std::fs::rename(&temporario, &destino) {
            if destino.is_file() {
                let _ = std::fs::remove_file(&temporario);
                continue;
            }
            for instalado in instalados {
                let _ = std::fs::remove_file(instalado);
            }
            let _ = std::fs::remove_dir_all(&pasta_temporaria);
            return Err(format!("Erro ao concluir instalação de mods: {}", e));
        }
        instalados.push(destino);
    }
    let _ = std::fs::remove_dir_all(pasta_temporaria);
    Ok(())
}

pub(super) async fn instalar_mod_modrinth_compativel(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
    project_id: String,
    versao_minecraft: &str,
    loader: &Option<String>,
) -> Result<(), String> {
    let mut etapas = vec![EtapaResolucaoMod::Resolver(
        ReferenciaModObrigatorio::Modrinth {
            project_id: Some(project_id),
            version_id: None,
        },
    )];
    let mut visitados = std::collections::HashSet::new();
    let mut arquivos = Vec::new();

    while let Some(etapa) = etapas.pop() {
        match etapa {
            EtapaResolucaoMod::Resolver(referencia) => {
                if !visitados.insert(referencia.chave()) {
                    continue;
                }
                let resolvido =
                    resolver_arquivo_mod_obrigatorio(client, &referencia, versao_minecraft, loader)
                        .await?;
                let dependencias = resolvido.dependencias.clone();
                etapas.push(EtapaResolucaoMod::AgendarDownload(resolvido));
                for dependencia in dependencias.into_iter().rev() {
                    etapas.push(EtapaResolucaoMod::Resolver(dependencia));
                }
            }
            EtapaResolucaoMod::AgendarDownload(arquivo) => arquivos.push(arquivo),
        }
    }

    baixar_e_instalar_arquivos_mod(client, mods_dir, arquivos).await
}

pub(super) async fn instalar_mod_curseforge_compativel(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
    project_id: String,
    versao_minecraft: &str,
    loader: &Option<String>,
) -> Result<(), String> {
    let mut etapas = vec![EtapaResolucaoMod::Resolver(
        ReferenciaModObrigatorio::CurseForge {
            project_id,
            file_id: None,
        },
    )];
    let mut visitados = std::collections::HashSet::new();
    let mut arquivos = Vec::new();

    while let Some(etapa) = etapas.pop() {
        match etapa {
            EtapaResolucaoMod::Resolver(referencia) => {
                if !visitados.insert(referencia.chave()) {
                    continue;
                }
                let resolvido =
                    resolver_arquivo_mod_obrigatorio(client, &referencia, versao_minecraft, loader)
                        .await?;
                let dependencias = resolvido.dependencias.clone();
                etapas.push(EtapaResolucaoMod::AgendarDownload(resolvido));
                for dependencia in dependencias.into_iter().rev() {
                    etapas.push(EtapaResolucaoMod::Resolver(dependencia));
                }
            }
            EtapaResolucaoMod::AgendarDownload(arquivo) => arquivos.push(arquivo),
        }
    }

    baixar_e_instalar_arquivos_mod(client, mods_dir, arquivos).await
}

#[tauri::command]
pub(crate) async fn install_mod(
    instance_id: String,
    mod_info: ModInfo,
    state: State<'_, LauncherState>,
) -> Result<String, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mods_dir = instance.path.join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    let loader_instancia = normalizar_loader_para_mods(instance.loader_type.as_deref());
    let versao_instancia = instance.version.clone();
    let referencia_principal = match mod_info.platform {
        ModPlatform::Modrinth => ReferenciaModObrigatorio::Modrinth {
            project_id: Some(mod_info.id),
            version_id: mod_info.version_id,
        },
        ModPlatform::CurseForge => ReferenciaModObrigatorio::CurseForge {
            project_id: mod_info.id,
            file_id: mod_info.version_id,
        },
        _ => return Err("Plataforma não suportada para download".to_string()),
    };
    let chave_principal = referencia_principal.chave();
    let mut etapas = vec![EtapaResolucaoMod::Resolver(referencia_principal)];
    let mut visitados = std::collections::HashSet::new();
    let mut arquivos = Vec::new();
    let mut nome_arquivo_principal = None;

    while let Some(etapa) = etapas.pop() {
        match etapa {
            EtapaResolucaoMod::Resolver(referencia) => {
                if !visitados.insert(referencia.chave()) {
                    continue;
                }
                let resolvido = resolver_arquivo_mod_obrigatorio(
                    &client,
                    &referencia,
                    &versao_instancia,
                    &loader_instancia,
                )
                .await?;
                if !visitados.insert(resolvido.chave.clone())
                    && resolvido.chave != referencia.chave()
                {
                    continue;
                }
                if referencia.chave() == chave_principal {
                    nome_arquivo_principal = Some(resolvido.file_name.clone());
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

    baixar_e_instalar_arquivos_mod(&client, &mods_dir, arquivos).await?;
    nome_arquivo_principal.ok_or_else(|| "Arquivo principal do mod não foi resolvido.".to_string())
}

#[tauri::command]
pub(crate) async fn install_project_file(
    instance_id: String,
    project_type: String,
    download_url: String,
    file_name: String,
    state: State<'_, LauncherState>,
) -> Result<String, String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    baixar_arquivo_para_pasta(
        &pasta_destino,
        &tipo_normalizado,
        download_url,
        file_name,
        "projeto",
    )
    .await
}

fn pasta_destino_conteudo(
    instance: &Instance,
    tipo_normalizado: &str,
) -> Result<std::path::PathBuf, String> {
    match tipo_normalizado {
        "mod" => Ok(instance.path.join("mods")),
        "resourcepack" => Ok(instance.path.join("resourcepacks")),
        "shader" => Ok(instance.path.join("shaderpacks")),
        _ => Err(format!(
            "Tipo de projeto não suportado para instalação: {}",
            tipo_normalizado
        )),
    }
}

async fn baixar_arquivo_para_pasta(
    pasta_destino: &std::path::Path,
    tipo_normalizado: &str,
    download_url: String,
    file_name: String,
    prefixo_fallback: &str,
) -> Result<String, String> {
    std::fs::create_dir_all(pasta_destino).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;
    let resposta = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar arquivo do projeto: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "Download do projeto falhou com status {}",
            resposta.status()
        ));
    }

    let bytes = resposta
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes do projeto: {}", e))?;

    let extensao_padrao = if tipo_normalizado == "mod" {
        ".jar"
    } else {
        ".zip"
    };
    let nome_sugerido = if file_name.trim().is_empty() {
        let sem_query = download_url.split('?').next().unwrap_or_default();
        sem_query
            .rsplit('/')
            .next()
            .filter(|nome| !nome.is_empty())
            .map(|nome| nome.to_string())
            .unwrap_or_else(|| {
                format!(
                    "{}_{}{}",
                    prefixo_fallback,
                    chrono::Utc::now().timestamp_millis(),
                    extensao_padrao
                )
            })
    } else {
        file_name.trim().to_string()
    };

    let nome_arquivo_final = std::path::Path::new(&nome_sugerido)
        .file_name()
        .and_then(|nome| nome.to_str())
        .filter(|nome| !nome.is_empty())
        .map(|nome| nome.to_string())
        .unwrap_or_else(|| {
            format!(
                "{}_{}{}",
                prefixo_fallback,
                chrono::Utc::now().timestamp_millis(),
                extensao_padrao
            )
        });

    let caminho_arquivo = pasta_destino.join(&nome_arquivo_final);
    std::fs::write(caminho_arquivo, bytes).map_err(|e| e.to_string())?;

    Ok(nome_arquivo_final)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagemGaleriaProjetoCurseforge {
    url: String,
    raw_url: Option<String>,
    title: Option<String>,
    description: Option<String>,
    featured: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetalhesProjetoCurseforge {
    id: String,
    title: String,
    description: String,
    body: String,
    icon_url: String,
    author: String,
    slug: String,
    downloads: Option<u64>,
    categorias: Vec<String>,
    galeria: Vec<ImagemGaleriaProjetoCurseforge>,
}

#[tauri::command]
pub(crate) async fn buscar_detalhes_projeto_curseforge(
    project_id: String,
) -> Result<DetalhesProjetoCurseforge, String> {
    let client = reqwest::Client::new();
    let detalhes_url = format!("{}/mods/{}", CURSEFORGE_API_BASE, project_id);
    let request = anexar_headers_curseforge(client.get(&detalhes_url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar detalhes do CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao buscar detalhes: {}",
            resposta.status()
        ));
    }

    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear detalhes do CurseForge: {}", e))?;
    let dados = &payload["data"];

    if dados.is_null() {
        return Err("Resposta do CurseForge sem dados do projeto.".to_string());
    }

    let id = dados["id"].as_u64().unwrap_or(0).to_string();
    let title = dados["name"].as_str().unwrap_or("").to_string();
    let description = dados["summary"].as_str().unwrap_or("").to_string();
    let icon_url = dados["logo"]["url"].as_str().unwrap_or("").to_string();
    let author = dados["authors"]
        .as_array()
        .and_then(|autores| autores.first())
        .and_then(|autor| autor["name"].as_str())
        .unwrap_or("Autor desconhecido")
        .to_string();

    let website_url = dados["links"]["websiteUrl"].as_str().unwrap_or("");
    let slug = dados["slug"]
        .as_str()
        .map(|valor| valor.to_string())
        .or_else(|| extrair_slug_de_url_curseforge(website_url))
        .unwrap_or_default();

    let categorias = dados["categories"]
        .as_array()
        .map(|itens| {
            itens
                .iter()
                .filter_map(|categoria| {
                    categoria["name"]
                        .as_str()
                        .map(|nome| nome.trim().to_string())
                        .filter(|nome| !nome.is_empty())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let galeria = dados["screenshots"]
        .as_array()
        .map(|itens| {
            itens
                .iter()
                .filter_map(|imagem| {
                    let url_completa = imagem["url"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty())?;
                    let url_thumb = imagem["thumbnailUrl"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty());

                    let title = imagem["title"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty());
                    let description = imagem["description"]
                        .as_str()
                        .map(|valor| valor.trim().to_string())
                        .filter(|valor| !valor.is_empty());

                    Some(ImagemGaleriaProjetoCurseforge {
                        url: url_thumb.unwrap_or_else(|| url_completa.clone()),
                        raw_url: Some(url_completa),
                        title,
                        description,
                        featured: false,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let description_url = format!("{}/mods/{}/description", CURSEFORGE_API_BASE, project_id);
    let request_description = anexar_headers_curseforge(client.get(&description_url))?;
    let resposta_description = request_description
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar descrição do CurseForge: {}", e))?;

    let body = if resposta_description.status().is_success() {
        let payload_descricao: serde_json::Value = resposta_description
            .json()
            .await
            .map_err(|e| format!("Erro ao parsear descrição do CurseForge: {}", e))?;
        payload_descricao["data"].as_str().unwrap_or("").to_string()
    } else {
        String::new()
    };

    Ok(DetalhesProjetoCurseforge {
        id,
        title,
        description,
        body,
        icon_url,
        author,
        slug,
        downloads: dados["downloadCount"].as_u64(),
        categorias,
        galeria,
    })
}

#[tauri::command]
pub(crate) async fn install_curseforge_project_file(
    instance_id: String,
    project_type: String,
    project_id: String,
    state: State<'_, LauncherState>,
) -> Result<String, String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;
    let client = reqwest::Client::new();
    let loader_instancia = normalizar_loader_para_mods(instance.loader_type.as_deref());
    let selecao = SelecaoInstalacaoConteudo {
        id: project_id.clone(),
        nome: project_id,
        icone_url: None,
        plataforma: ModPlatform::CurseForge,
        tipo_projeto: tipo_normalizado.clone(),
    };
    let arquivo =
        resolver_projeto_sem_dependencias(&client, &selecao, &instance.version, &loader_instancia)
            .await?;

    baixar_arquivo_para_pasta(
        &pasta_destino,
        &tipo_normalizado,
        arquivo.download_url,
        arquivo.file_name,
        "curseforge",
    )
    .await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DadosInstalacaoModpackCurseforge {
    nome_modpack: String,
    versao_modpack: String,
    versao_minecraft: String,
    loader_type: String,
    download_url: String,
    file_name: String,
}

fn arquivo_modpack_curseforge_valido(arquivo: &serde_json::Value) -> bool {
    let nome = arquivo["fileName"].as_str().unwrap_or("").to_lowercase();
    if !nome.ends_with(".zip") {
        return false;
    }
    arquivo["downloadUrl"]
        .as_str()
        .map(|u| !u.trim().is_empty())
        .unwrap_or(false)
}

fn escolher_arquivo_modpack_curseforge(
    arquivos: &[serde_json::Value],
) -> Option<&serde_json::Value> {
    arquivos
        .iter()
        .find(|arquivo| arquivo_modpack_curseforge_valido(arquivo))
}

#[tauri::command]
pub(crate) async fn resolver_modpack_curseforge(
    project_id: String,
) -> Result<DadosInstalacaoModpackCurseforge, String> {
    let client = reqwest::Client::new();
    let files_url = format!(
        "{}/mods/{}/files?pageSize=50&sortField=1&sortOrder=desc",
        CURSEFORGE_API_BASE, project_id
    );
    let request = anexar_headers_curseforge(client.get(&files_url))?;
    let resposta = request
        .send()
        .await
        .map_err(|e| format!("Erro ao listar arquivos do modpack CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou erro ao listar modpack: {}",
            resposta.status()
        ));
    }

    let payload: serde_json::Value = resposta
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta do CurseForge: {}", e))?;
    let arquivos = payload["data"]
        .as_array()
        .ok_or("Resposta do CurseForge sem lista de arquivos.")?;

    let arquivo = escolher_arquivo_modpack_curseforge(arquivos)
        .ok_or("Nenhum arquivo de modpack CurseForge com download disponível foi encontrado.")?;

    let download_url = arquivo["downloadUrl"]
        .as_str()
        .ok_or("Arquivo de modpack sem URL de download.")?
        .to_string();
    let file_name = arquivo["fileName"]
        .as_str()
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("modpack.zip")
        .to_string();

    let mut nome_modpack = arquivo["displayName"]
        .as_str()
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("Modpack CurseForge")
        .to_string();
    let mut versao_modpack = arquivo["displayName"]
        .as_str()
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("latest")
        .to_string();

    let (versoes_mc, loaders_tags) = extrair_tags_arquivo_curseforge(arquivo);
    let mut versao_minecraft = versoes_mc.first().cloned();
    let mut loader_type = loaders_tags
        .first()
        .cloned()
        .unwrap_or_else(|| "vanilla".to_string());

    let bytes = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar modpack CurseForge: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes do modpack CurseForge: {}", e))?;

    let cursor = std::io::Cursor::new(bytes.to_vec());
    if let Ok(mut archive) = zip::ZipArchive::new(cursor) {
        if let Ok(mut manifesto) = archive.by_name("manifest.json") {
            let mut conteudo = String::new();
            if std::io::Read::read_to_string(&mut manifesto, &mut conteudo).is_ok() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&conteudo) {
                    if let Some(nome) = json["name"].as_str().filter(|nome| !nome.trim().is_empty())
                    {
                        nome_modpack = nome.to_string();
                    }

                    if let Some(versao) = json["version"].as_str() {
                        if !versao.trim().is_empty() {
                            versao_modpack = versao.to_string();
                        }
                    } else if let Some(versao_num) = json["version"].as_i64() {
                        versao_modpack = versao_num.to_string();
                    }

                    if let Some(versao_mc) = json["minecraft"]["version"].as_str() {
                        if !versao_mc.trim().is_empty() {
                            versao_minecraft = Some(versao_mc.to_string());
                        }
                    }

                    if let Some(loaders) = json["minecraft"]["modLoaders"].as_array() {
                        for loader in loaders {
                            let id_loader = loader["id"]
                                .as_str()
                                .or_else(|| loader.as_str())
                                .unwrap_or("");
                            if let Some(loader_normalizado) =
                                detectar_loader_normalizado(Some(id_loader))
                            {
                                loader_type = loader_normalizado;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let versao_minecraft = versao_minecraft
        .filter(|versao| !versao.trim().is_empty())
        .ok_or("Não foi possível detectar a versão do Minecraft do modpack CurseForge.")?;

    if !matches!(loader_type.as_str(), "forge" | "fabric" | "neoforge") {
        loader_type = "vanilla".to_string();
    }

    Ok(DadosInstalacaoModpackCurseforge {
        nome_modpack,
        versao_modpack,
        versao_minecraft,
        loader_type,
        download_url,
        file_name,
    })
}

#[tauri::command]
pub(crate) fn get_installed_mods(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<String>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mods_dir = instance.path.join("mods");

    if !mods_dir.exists() {
        return Ok(vec![]);
    }

    let mut mods = vec![];
    if let Ok(entries) = std::fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".jar") || file_name.ends_with(".jar.disabled") {
                    mods.push(file_name.to_string());
                }
            }
        }
    }

    Ok(mods)
}

#[tauri::command]
pub(crate) fn get_installed_resourcepacks(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<String>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let resourcepacks_dir = instance.path.join("resourcepacks");

    if !resourcepacks_dir.exists() {
        return Ok(vec![]);
    }

    let mut packs = vec![];
    if let Ok(entries) = std::fs::read_dir(resourcepacks_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".zip")
                    || file_name.ends_with(".zip.disabled")
                    || entry.path().is_dir()
                {
                    packs.push(file_name.to_string());
                }
            }
        }
    }

    Ok(packs)
}

#[tauri::command]
pub(crate) fn get_installed_shaders(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<String>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let shaders_dir = instance.path.join("shaderpacks");

    if !shaders_dir.exists() {
        return Ok(vec![]);
    }

    let mut shaders = vec![];
    if let Ok(entries) = std::fs::read_dir(shaders_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.ends_with(".zip")
                    || file_name.ends_with(".zip.disabled")
                    || entry.path().is_dir()
                {
                    shaders.push(file_name.to_string());
                }
            }
        }
    }

    Ok(shaders)
}

#[tauri::command]
pub(crate) fn remove_mod(
    instance_id: String,
    mod_file: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mod_path = instance.path.join("mods").join(mod_file);
    std::fs::remove_file(mod_path).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn remove_project_file(
    instance_id: String,
    project_type: String,
    file_name: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    let nome_seguro = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nome de arquivo inválido para remoção.")?
        .to_string();

    if nome_seguro.is_empty() {
        return Err("Nome de arquivo vazio para remoção.".to_string());
    }

    let caminho_alvo = pasta_destino.join(&nome_seguro);
    if !caminho_alvo.exists() {
        return Ok(());
    }

    let caminho_validado = validar_caminho_dentro_raiz(&pasta_destino, &caminho_alvo)?;
    if caminho_validado.is_dir() {
        std::fs::remove_dir_all(caminho_validado).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(caminho_validado).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn toggle_project_file_enabled(
    instance_id: String,
    project_type: String,
    file_name: String,
    enabled: bool,
    state: State<LauncherState>,
) -> Result<String, String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let tipo_normalizado = project_type.trim().to_lowercase();
    let pasta_destino = pasta_destino_conteudo(&instance, &tipo_normalizado)?;

    let nome_seguro = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Nome de arquivo inválido para alterar estado.")?
        .to_string();

    if nome_seguro.is_empty() {
        return Err("Nome de arquivo vazio para alterar estado.".to_string());
    }

    let nome_habilitado = if nome_seguro.ends_with(".disabled") {
        nome_seguro.trim_end_matches(".disabled").to_string()
    } else {
        nome_seguro.clone()
    };
    let nome_desabilitado = if nome_habilitado.ends_with(".disabled") {
        nome_habilitado.clone()
    } else {
        format!("{}.disabled", nome_habilitado)
    };

    let origem_nome = if enabled {
        nome_desabilitado.clone()
    } else {
        nome_habilitado.clone()
    };
    let destino_nome = if enabled {
        nome_habilitado.clone()
    } else {
        nome_desabilitado.clone()
    };

    let caminho_origem = pasta_destino.join(&origem_nome);
    let caminho_destino = pasta_destino.join(&destino_nome);

    if caminho_destino.exists() && !caminho_origem.exists() {
        return Ok(destino_nome);
    }
    if !caminho_origem.exists() {
        return Err(format!(
            "Arquivo '{}' não encontrado para alterar estado.",
            origem_nome
        ));
    }

    let origem_validada = validar_caminho_dentro_raiz(&pasta_destino, &caminho_origem)?;
    let _ = validar_caminho_dentro_raiz(
        &pasta_destino,
        caminho_destino.parent().unwrap_or(&pasta_destino),
    )?;

    std::fs::rename(origem_validada, &caminho_destino)
        .map_err(|e| format!("Falha ao alternar estado do arquivo: {}", e))?;

    Ok(destino_nome)
}

// ===== FUNÇÕES DE BUSCA DE MODS =====

fn normalizar_tipo_conteudo(tipo: Option<String>) -> String {
    let normalizado = tipo
        .unwrap_or_else(|| "mod".to_string())
        .trim()
        .to_lowercase();

    match normalizado.as_str() {
        "modpack" | "resourcepack" | "shader" => normalizado,
        _ => "mod".to_string(),
    }
}

fn normalizar_ordenacao_busca(ordenacao: Option<String>) -> String {
    match ordenacao
        .unwrap_or_else(|| "relevancia".to_string())
        .trim()
        .to_lowercase()
        .as_str()
    {
        "popularidade" => "popularidade".to_string(),
        "downloads" => "downloads".to_string(),
        "atualizados" => "atualizados".to_string(),
        "recentes" => "recentes".to_string(),
        _ => "relevancia".to_string(),
    }
}

fn ordenacao_curseforge(ordenacao: &str) -> u8 {
    match ordenacao {
        "downloads" => 6,
        "atualizados" => 3,
        "recentes" => 11,
        _ => 2,
    }
}

fn ordenacao_modrinth(ordenacao: &str) -> &'static str {
    match ordenacao {
        "popularidade" => "follows",
        "downloads" => "downloads",
        "atualizados" => "updated",
        "recentes" => "newest",
        _ => "relevance",
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CategoriaBuscaOnline {
    id: String,
    nome: String,
    modrinth: Option<String>,
    curseforge: Option<u32>,
}

#[derive(Default)]
struct CategoriaBuscaParcial {
    nome: String,
    modrinth: Option<String>,
    curseforge: Option<u32>,
}

fn chave_categoria_busca(valor: &str) -> String {
    valor
        .chars()
        .filter(|caractere| caractere.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn formatar_nome_categoria(valor: &str) -> String {
    valor
        .split(['-', '_'])
        .filter(|parte| !parte.is_empty())
        .map(|parte| {
            let mut caracteres = parte.chars();
            match caracteres.next() {
                Some(inicial) => inicial.to_uppercase().chain(caracteres).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn categoria_modrinth_valida(categoria: &str) -> bool {
    !categoria.is_empty()
        && categoria.len() <= 80
        && categoria
            .chars()
            .all(|caractere| caractere.is_ascii_alphanumeric() || matches!(caractere, '-' | '_'))
}

async fn buscar_categorias_modrinth(
    client: &reqwest::Client,
    tipo_conteudo: &str,
) -> Result<Vec<(String, String)>, String> {
    let url = format!("{}/tag/category", MODRINTH_API_BASE);
    let resposta = client
        .get(url)
        .header("User-Agent", "DomeLauncher/1.0")
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar categorias do Modrinth: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "Modrinth retornou HTTP {} ao listar categorias.",
            resposta.status().as_u16()
        ));
    }

    let categorias = resposta
        .json::<Vec<serde_json::Value>>()
        .await
        .map_err(|e| format!("Erro ao interpretar categorias do Modrinth: {}", e))?;

    Ok(categorias
        .into_iter()
        .filter(|categoria| categoria["project_type"].as_str() == Some(tipo_conteudo))
        .filter(|categoria| categoria["header"].as_str() != Some("loaders"))
        .filter_map(|categoria| {
            let slug = categoria["name"].as_str()?.trim();
            categoria_modrinth_valida(slug)
                .then(|| (slug.to_string(), formatar_nome_categoria(slug)))
        })
        .collect())
}

async fn buscar_categorias_curseforge(
    client: &reqwest::Client,
    tipo_conteudo: &str,
) -> Result<Vec<(u32, String, String)>, String> {
    let class_id = class_id_por_tipo_conteudo(tipo_conteudo);
    let url = format!(
        "{}/categories?gameId=432&classId={}",
        CURSEFORGE_API_BASE, class_id
    );
    let resposta = anexar_headers_curseforge(client.get(url))?
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar categorias do CurseForge: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou HTTP {} ao listar categorias.",
            resposta.status().as_u16()
        ));
    }

    let corpo = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Erro ao interpretar categorias do CurseForge: {}", e))?;

    Ok(corpo["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|categoria| categoria["isClass"].as_bool() != Some(true))
        .filter_map(|categoria| {
            let id = categoria["id"].as_u64()?.try_into().ok()?;
            let nome = categoria["name"].as_str()?.trim().to_string();
            let slug = categoria["slug"]
                .as_str()
                .unwrap_or(&nome)
                .trim()
                .to_string();
            Some((id, nome, slug))
        })
        .collect())
}

fn mesclar_categorias_busca(
    modrinth: Vec<(String, String)>,
    curseforge: Vec<(u32, String, String)>,
) -> Vec<CategoriaBuscaOnline> {
    let mut categorias = std::collections::BTreeMap::<String, CategoriaBuscaParcial>::new();

    for (slug, nome) in modrinth {
        let chave = chave_categoria_busca(&slug);
        let categoria = categorias.entry(chave).or_default();
        categoria.nome = nome;
        categoria.modrinth = Some(slug);
    }

    for (id, nome, slug) in curseforge {
        let chave_slug = chave_categoria_busca(&slug);
        let chave_nome = chave_categoria_busca(&nome);
        let chave = if categorias.contains_key(&chave_slug) {
            chave_slug
        } else {
            chave_nome
        };
        let categoria = categorias.entry(chave).or_default();
        categoria.nome = nome;
        categoria.curseforge = Some(id);
    }

    let mut resultado = categorias
        .into_iter()
        .filter(|(_, categoria)| !categoria.nome.is_empty())
        .map(|(id, categoria)| CategoriaBuscaOnline {
            id,
            nome: categoria.nome,
            modrinth: categoria.modrinth,
            curseforge: categoria.curseforge,
        })
        .collect::<Vec<_>>();
    resultado.sort_by_key(|categoria| categoria.nome.to_lowercase());
    resultado
}

#[tauri::command]
pub(crate) async fn listar_categorias_busca_online(
    content_type: Option<String>,
) -> Result<Vec<CategoriaBuscaOnline>, String> {
    let tipo_conteudo = normalizar_tipo_conteudo(content_type);
    let client = reqwest::Client::new();
    let (modrinth, curseforge) = tokio::join!(
        buscar_categorias_modrinth(&client, &tipo_conteudo),
        buscar_categorias_curseforge(&client, &tipo_conteudo)
    );

    match (modrinth, curseforge) {
        (Ok(modrinth), Ok(curseforge)) => Ok(mesclar_categorias_busca(modrinth, curseforge)),
        (Ok(modrinth), Err(_)) => Ok(mesclar_categorias_busca(modrinth, Vec::new())),
        (Err(_), Ok(curseforge)) => Ok(mesclar_categorias_busca(Vec::new(), curseforge)),
        (Err(erro_modrinth), Err(erro_curseforge)) => Err(format!(
            "Não foi possível carregar categorias. {} | {}",
            erro_modrinth, erro_curseforge
        )),
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct FiltrosBuscaOnline {
    game_version: Option<String>,
    loader: Option<String>,
    categorias_modrinth: Vec<String>,
    categorias_curseforge: Vec<u32>,
    categorias_negadas_modrinth: Vec<String>,
    categorias_negadas_curseforge: Vec<u32>,
    sort: Option<String>,
    offset: Option<u32>,
    limit: Option<u32>,
}

struct ParametrosBuscaOnline<'a> {
    query: &'a str,
    tipo_conteudo: &'a str,
    game_version: Option<&'a str>,
    loader: Option<&'a str>,
    categorias_modrinth: &'a [String],
    categorias_curseforge: &'a [u32],
    categorias_negadas_modrinth: &'a [String],
    categorias_negadas_curseforge: &'a [u32],
    ordenacao: &'a str,
    offset: u32,
    limit: u32,
}

fn criar_facetas_categorias_modrinth(
    categorias_incluidas: &[String],
    categorias_negadas: &[String],
) -> Vec<Vec<String>> {
    let mut facetas = Vec::new();
    if !categorias_incluidas.is_empty() {
        facetas.push(
            categorias_incluidas
                .iter()
                .map(|categoria| format!("categories:{}", categoria))
                .collect(),
        );
    }
    facetas.extend(
        categorias_negadas
            .iter()
            .map(|categoria| vec![format!("categories!={}", categoria)])
            .collect::<Vec<_>>(),
    );
    facetas
}

fn serializar_categorias_curseforge(categorias: &[u32]) -> Option<String> {
    (!categorias.is_empty()).then(|| {
        let ids = categorias.iter().map(u32::to_string).collect::<Vec<_>>();
        format!("[{}]", ids.join(","))
    })
}

fn possui_categoria_curseforge(projeto: &serde_json::Value, categorias_proibidas: &[u32]) -> bool {
    projeto["categories"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|categoria| categoria["id"].as_u64())
        .filter_map(|id| u32::try_from(id).ok())
        .any(|id| categorias_proibidas.contains(&id))
}

#[cfg(test)]
mod testes_filtros_busca {
    use super::*;

    #[test]
    fn converte_ordenacoes_para_as_duas_plataformas() {
        assert_eq!(ordenacao_curseforge("downloads"), 6);
        assert_eq!(ordenacao_curseforge("atualizados"), 3);
        assert_eq!(ordenacao_modrinth("popularidade"), "follows");
        assert_eq!(ordenacao_modrinth("recentes"), "newest");
    }

    #[test]
    fn usa_relevancia_quando_ordenacao_for_desconhecida() {
        assert_eq!(
            normalizar_ordenacao_busca(Some("invalida".to_string())),
            "relevancia"
        );
        assert_eq!(ordenacao_curseforge("relevancia"), 2);
        assert_eq!(ordenacao_modrinth("relevancia"), "relevance");
    }

    #[test]
    fn mescla_categorias_equivalentes_sem_confundir_taxonomias() {
        let categorias = mesclar_categorias_busca(
            vec![("technology".to_string(), "Technology".to_string())],
            vec![(123, "Technology".to_string(), "technology".to_string())],
        );

        assert_eq!(categorias.len(), 1);
        assert_eq!(categorias[0].modrinth.as_deref(), Some("technology"));
        assert_eq!(categorias[0].curseforge, Some(123));
    }

    #[test]
    fn rejeita_categoria_modrinth_que_possa_injetar_facet() {
        assert!(categoria_modrinth_valida("world-generation"));
        assert!(!categoria_modrinth_valida("technology\"]]"));
    }

    #[test]
    fn prepara_multiplas_categorias_para_as_duas_plataformas() {
        let categorias_incluidas = vec!["technology".to_string(), "adventure".to_string()];
        let categorias_negadas = vec!["magic".to_string(), "storage".to_string()];
        assert_eq!(
            criar_facetas_categorias_modrinth(&categorias_incluidas, &categorias_negadas),
            vec![
                vec!["categories:technology", "categories:adventure"],
                vec!["categories!=magic"],
                vec!["categories!=storage"]
            ]
        );
        assert_eq!(
            serializar_categorias_curseforge(&[6, 12]).as_deref(),
            Some("[6,12]")
        );
        let projeto = serde_json::json!({ "categories": [{ "id": 6 }, { "id": 18 }] });
        assert!(possui_categoria_curseforge(&projeto, &[6, 12]));
        assert!(!possui_categoria_curseforge(&projeto, &[12]));
    }
}

#[tauri::command]
pub(crate) async fn search_mods_online(
    query: String,
    platform: Option<ModPlatform>,
    content_type: Option<String>,
    filtros: Option<FiltrosBuscaOnline>,
) -> Result<Vec<ModSearchResult>, String> {
    let tipo_conteudo = normalizar_tipo_conteudo(content_type);
    let filtros = filtros.unwrap_or_default();
    let mut categorias_modrinth = filtros
        .categorias_modrinth
        .iter()
        .map(|categoria| categoria.trim().to_string())
        .filter(|categoria| !categoria.is_empty())
        .collect::<Vec<_>>();
    categorias_modrinth.sort();
    categorias_modrinth.dedup();
    if categorias_modrinth.len() > 10
        || !categorias_modrinth
            .iter()
            .all(|categoria| categoria_modrinth_valida(categoria))
    {
        return Err("Categorias Modrinth inválidas.".to_string());
    }
    let mut categorias_curseforge = filtros
        .categorias_curseforge
        .iter()
        .copied()
        .filter(|id| *id > 0)
        .collect::<Vec<_>>();
    categorias_curseforge.sort_unstable();
    categorias_curseforge.dedup();
    if categorias_curseforge.len() > 10 {
        return Err("O CurseForge permite no máximo 10 categorias por busca.".to_string());
    }
    let mut categorias_negadas_modrinth = filtros
        .categorias_negadas_modrinth
        .iter()
        .map(|categoria| categoria.trim().to_string())
        .filter(|categoria| !categoria.is_empty())
        .collect::<Vec<_>>();
    categorias_negadas_modrinth.sort();
    categorias_negadas_modrinth.dedup();
    if categorias_negadas_modrinth.len() > 10
        || !categorias_negadas_modrinth
            .iter()
            .all(|categoria| categoria_modrinth_valida(categoria))
    {
        return Err("Categorias negadas do Modrinth inválidas.".to_string());
    }
    let mut categorias_negadas_curseforge = filtros
        .categorias_negadas_curseforge
        .iter()
        .copied()
        .filter(|id| *id > 0)
        .collect::<Vec<_>>();
    categorias_negadas_curseforge.sort_unstable();
    categorias_negadas_curseforge.dedup();
    if categorias_negadas_curseforge.len() > 10 {
        return Err("O CurseForge permite negar no máximo 10 categorias por busca.".to_string());
    }
    if categorias_modrinth
        .iter()
        .any(|categoria| categorias_negadas_modrinth.contains(categoria))
        || categorias_curseforge
            .iter()
            .any(|categoria| categorias_negadas_curseforge.contains(categoria))
    {
        return Err("Uma categoria não pode ser incluída e negada ao mesmo tempo.".to_string());
    }
    let ordenacao = normalizar_ordenacao_busca(filtros.sort);
    let parametros = ParametrosBuscaOnline {
        query: &query,
        tipo_conteudo: &tipo_conteudo,
        game_version: filtros.game_version.as_deref(),
        loader: filtros.loader.as_deref(),
        categorias_modrinth: &categorias_modrinth,
        categorias_curseforge: &categorias_curseforge,
        categorias_negadas_modrinth: &categorias_negadas_modrinth,
        categorias_negadas_curseforge: &categorias_negadas_curseforge,
        ordenacao: &ordenacao,
        offset: filtros.offset.unwrap_or(0),
        limit: filtros.limit.unwrap_or(20).clamp(1, 50),
    };
    let client = reqwest::Client::new();
    let mut results = Vec::new();
    let mut erros = Vec::new();

    // Se não especificar plataforma, buscar em ambas
    let platforms_to_search = match platform {
        Some(p) => vec![p],
        None => vec![ModPlatform::CurseForge, ModPlatform::Modrinth],
    };

    for platform in platforms_to_search {
        match platform {
            ModPlatform::CurseForge => {
                match search_curseforge_conteudo(&client, &parametros).await {
                    Ok(mut curseforge_results) => results.append(&mut curseforge_results),
                    Err(e) => {
                        eprintln!("Erro ao buscar no CurseForge: {}", e);
                        erros.push(format!("CurseForge: {}", e));
                    }
                }
            }
            ModPlatform::Modrinth => match search_modrinth_conteudo(&client, &parametros).await {
                Ok(mut modrinth_results) => results.append(&mut modrinth_results),
                Err(e) => {
                    eprintln!("Erro ao buscar no Modrinth: {}", e);
                    erros.push(format!("Modrinth: {}", e));
                }
            },
            ModPlatform::Ftb => {
                // FTB pode ser implementado futuramente
                continue;
            }
        }
    }

    if results.is_empty() && !erros.is_empty() {
        return Err(erros.join(" | "));
    }

    Ok(results)
}

async fn search_curseforge_conteudo(
    client: &reqwest::Client,
    parametros: &ParametrosBuscaOnline<'_>,
) -> Result<Vec<ModSearchResult>, String> {
    let class_id = class_id_por_tipo_conteudo(parametros.tipo_conteudo);
    let campo_ordenacao = ordenacao_curseforge(parametros.ordenacao);
    let mut search_url = format!(
        "{}/mods/search?gameId=432&searchFilter={}&classId={}&index={}&pageSize={}&sortField={}&sortOrder=desc",
        CURSEFORGE_API_BASE,
        urlencoding::encode(parametros.query),
        class_id,
        parametros.offset,
        parametros.limit,
        campo_ordenacao,
    );
    let game_version = parametros
        .game_version
        .map(str::trim)
        .filter(|valor| !valor.is_empty());
    if let Some(game_version) = game_version {
        search_url.push_str(&format!(
            "&gameVersion={}",
            urlencoding::encode(game_version)
        ));
    }
    if matches!(parametros.tipo_conteudo, "mod" | "modpack") {
        if let Some(loader_id) = parametros.loader.and_then(id_loader_curseforge) {
            search_url.push_str(&format!("&modLoaderType={}", loader_id));
        }
    }
    if let Some(categorias) = serializar_categorias_curseforge(parametros.categorias_curseforge) {
        search_url.push_str(&format!(
            "&categoryIds={}",
            urlencoding::encode(&categorias)
        ));
    }

    let request = anexar_headers_curseforge(client.get(&search_url))?;
    let resposta_http = request
        .send()
        .await
        .map_err(|e| format!("Erro na busca CurseForge: {}", e))?;

    if !resposta_http.status().is_success() {
        let status = resposta_http.status();
        let corpo = resposta_http.text().await.unwrap_or_default();
        let trecho: String = corpo.chars().take(200).collect();
        let dica_key = if status == reqwest::StatusCode::UNAUTHORIZED
            || status == reqwest::StatusCode::FORBIDDEN
        {
            " Verifique a chave da API (CURSEFORGE_API_KEY ou fallback configurado no backend)."
                .to_string()
        } else {
            String::new()
        };
        return Err(format!(
            "CurseForge retornou HTTP {} — {}{}",
            status.as_u16(),
            trecho,
            dica_key
        ));
    }

    let texto_corpo = resposta_http
        .text()
        .await
        .map_err(|e| format!("Erro ao ler corpo da resposta CurseForge: {}", e))?;
    let response: serde_json::Value = serde_json::from_str(&texto_corpo).map_err(|e| {
        let trecho: String = texto_corpo.chars().take(200).collect();
        format!("Erro ao parsear JSON CurseForge: {} — Corpo: {}", e, trecho)
    })?;

    let mut results = Vec::new();

    if let Some(data) = response["data"].as_array() {
        for mod_data in data {
            let id = mod_data["id"].as_u64().unwrap_or(0).to_string();
            let name = mod_data["name"]
                .as_str()
                .unwrap_or("Nome desconhecido")
                .to_string();
            let summary = mod_data["summary"].as_str().unwrap_or("").to_string();
            let authors = mod_data["authors"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|author| author["name"].as_str())
                .unwrap_or("Autor desconhecido")
                .to_string();

            let download_count = mod_data["downloadCount"].as_u64();
            let logo = mod_data["logo"]["url"].as_str().map(|s| s.to_string());
            let website_url = mod_data["links"]["websiteUrl"]
                .as_str()
                .unwrap_or(&format!(
                    "https://www.curseforge.com/minecraft/{}/{}",
                    rota_curseforge_por_tipo_conteudo(parametros.tipo_conteudo),
                    id,
                ))
                .to_string();
            let slug = mod_data["slug"]
                .as_str()
                .map(|s| s.to_string())
                .or_else(|| extrair_slug_de_url_curseforge(&website_url));

            results.push(ModSearchResult {
                id,
                name,
                description: summary,
                author: authors,
                platform: ModPlatform::CurseForge,
                download_count,
                icon_url: logo,
                project_url: website_url,
                latest_version: None, // CurseForge não retorna versão na busca básica
                slug,
                project_type: Some(parametros.tipo_conteudo.to_string()),
                file_name: None,
                oculto_por_categoria: possui_categoria_curseforge(
                    mod_data,
                    parametros.categorias_negadas_curseforge,
                ),
            });
        }
    }
    Ok(results)
}

async fn search_modrinth_conteudo(
    client: &reqwest::Client,
    parametros: &ParametrosBuscaOnline<'_>,
) -> Result<Vec<ModSearchResult>, String> {
    let mut facets = vec![vec![format!("project_type:{}", parametros.tipo_conteudo)]];
    if let Some(game_version) = parametros
        .game_version
        .map(str::trim)
        .filter(|valor| !valor.is_empty())
    {
        facets.push(vec![format!("versions:{}", game_version)]);
    }
    if matches!(parametros.tipo_conteudo, "mod" | "modpack") {
        if let Some(loader) = parametros
            .loader
            .map(str::trim)
            .filter(|valor| !valor.is_empty())
        {
            facets.push(vec![format!("categories:{}", loader.to_lowercase())]);
        }
    }
    facets.extend(criar_facetas_categorias_modrinth(
        parametros.categorias_modrinth,
        parametros.categorias_negadas_modrinth,
    ));
    let facets = serde_json::to_string(&facets)
        .map_err(|e| format!("Erro ao preparar filtros do Modrinth: {}", e))?;
    let indice_ordenacao = ordenacao_modrinth(parametros.ordenacao);
    let search_url = format!(
        "{}/search?query={}&facets={}&index={}&offset={}&limit={}",
        MODRINTH_API_BASE,
        urlencoding::encode(parametros.query),
        urlencoding::encode(&facets),
        indice_ordenacao,
        parametros.offset,
        parametros.limit,
    );

    let response = client
        .get(&search_url)
        .header("User-Agent", "HeliosLauncher/1.0")
        .send()
        .await
        .map_err(|e| format!("Erro na busca Modrinth: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Erro ao parsear resposta Modrinth: {}", e))?;

    let mut results = Vec::new();

    if let Some(hits) = response["hits"].as_array() {
        for hit in hits {
            let id = hit["project_id"].as_str().unwrap_or("").to_string();
            let name = hit["title"]
                .as_str()
                .unwrap_or("Nome desconhecido")
                .to_string();
            let description = hit["description"].as_str().unwrap_or("").to_string();
            let author = hit["author"]
                .as_str()
                .unwrap_or("Autor desconhecido")
                .to_string();
            let slug = hit["slug"].as_str().map(|s| s.to_string());

            let download_count = hit["downloads"].as_u64();
            let icon_url = hit["icon_url"].as_str().map(|s| s.to_string());
            let project_url = if let Some(slug) = &slug {
                format!("https://modrinth.com/{}/{}", parametros.tipo_conteudo, slug)
            } else {
                format!("https://modrinth.com/{}/{}", parametros.tipo_conteudo, id)
            };

            results.push(ModSearchResult {
                id,
                name,
                description,
                author,
                platform: ModPlatform::Modrinth,
                download_count,
                icon_url,
                project_url,
                latest_version: hit["latest_version"].as_str().map(|s| s.to_string()),
                slug,
                project_type: Some(
                    hit["project_type"]
                        .as_str()
                        .unwrap_or(parametros.tipo_conteudo)
                        .to_string(),
                ),
                file_name: None,
                oculto_por_categoria: false,
            });
        }
    }
    Ok(results)
}

// ===== FUNÇÕES DE LOGS =====

// ===== ESTRUTURAS PARA BUSCA DE MODS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModSearchResult {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub platform: ModPlatform,
    pub download_count: Option<u64>,
    pub icon_url: Option<String>,
    pub project_url: String,
    pub latest_version: Option<String>,
    pub slug: Option<String>,
    pub project_type: Option<String>,
    pub file_name: Option<String>,
    pub oculto_por_categoria: bool,
}
