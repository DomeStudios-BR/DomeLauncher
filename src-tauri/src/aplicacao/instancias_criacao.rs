use super::*;
use sha2::{Digest, Sha512};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoaderVersionInfo {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct LoaderVersionsResponse {
    pub versions: Vec<LoaderVersionInfo>,
}

/// Busca versões disponíveis dos loaders (Fabric, Forge, NeoForge)
#[tauri::command]
pub(crate) async fn get_loader_versions(
    loader_type: String,
    minecraft_version: Option<String>,
) -> Result<LoaderVersionsResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;

    let versions = match loader_type.to_lowercase().as_str() {
        "fabric" => {
            let minecraft_version = minecraft_version
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty());
            let url = minecraft_version
                .map(|version| {
                    format!(
                        "https://meta.fabricmc.net/v2/versions/loader/{}",
                        urlencoding::encode(version)
                    )
                })
                .unwrap_or_else(|| "https://meta.fabricmc.net/v2/versions/loader".to_string());
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Erro ao buscar versões do Fabric: {}", e))?;

            if !response.status().is_success() {
                return Err(format!(
                    "API do Fabric retornou erro: {}",
                    response.status()
                ));
            }

            let fabric_versions: Vec<serde_json::Value> = response
                .json()
                .await
                .map_err(|e| format!("Erro ao parsear resposta do Fabric: {}", e))?;

            fabric_versions
                .iter()
                .filter_map(|v| {
                    let loader = v.get("loader").unwrap_or(v);
                    let version = loader["version"].as_str()?.to_string();
                    let stable = loader["stable"].as_bool();
                    Some(LoaderVersionInfo { version, stable })
                })
                .collect::<Vec<_>>()
        }
        "forge" => {
            // API do Forge - usa o promotions endpoint para versões estáveis
            let url =
                "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Erro ao buscar versões do Forge: {}", e))?;

            if !response.status().is_success() {
                return Err(format!("API do Forge retornou erro: {}", response.status()));
            }

            let forge_data: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Erro ao parsear resposta do Forge: {}", e))?;

            // Extrair versões únicas do Forge
            let mut versions_set = std::collections::HashSet::new();
            if let Some(promos) = forge_data["promos"].as_object() {
                for (key, value) in promos {
                    // Formato: "1.20.1-latest" ou "1.20.1-recommended" -> valor é a build do Forge
                    if let Some(forge_version) = value.as_str() {
                        // Extrair versão do MC a partir da chave
                        if let Some(mc_version) = key.split('-').next() {
                            if minecraft_version
                                .as_deref()
                                .is_some_and(|version| mc_version != version.trim())
                            {
                                continue;
                            }
                            let full_version = format!("{}-{}", mc_version, forge_version);
                            versions_set.insert(full_version);
                        }
                    }
                }
            }

            let mut versions: Vec<LoaderVersionInfo> = versions_set
                .into_iter()
                .map(|v| LoaderVersionInfo {
                    version: v,
                    stable: Some(true),
                })
                .collect();

            versions.sort_by(|a, b| comparar_versoes_loader_desc(&a.version, &b.version));
            versions
        }
        "neoforge" => {
            // API do NeoForge para listar versões
            let url =
                "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
            let response = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Erro ao buscar versões do NeoForge: {}", e))?;

            if !response.status().is_success() {
                return Err(format!(
                    "API do NeoForge retornou erro: {}",
                    response.status()
                ));
            }

            let neoforge_data: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Erro ao parsear resposta do NeoForge: {}", e))?;

            // O endpoint retorna um array de versões
            if let Some(versions_arr) = neoforge_data["versions"].as_array() {
                let prefixo_minecraft = minecraft_version
                    .as_deref()
                    .map(|versao| {
                        prefixo_neoforge_para_minecraft(versao).ok_or_else(|| {
                            format!("Versão do Minecraft inválida para o NeoForge: {}", versao)
                        })
                    })
                    .transpose()?;
                let mut versions = versions_arr
                    .iter()
                    .filter_map(|v| {
                        let version = v.as_str()?.to_string();
                        if prefixo_minecraft
                            .as_deref()
                            .is_some_and(|prefixo| !version.starts_with(prefixo))
                        {
                            return None;
                        }
                        Some(LoaderVersionInfo {
                            version,
                            stable: Some(true),
                        })
                    })
                    .collect::<Vec<_>>();
                versions.sort_by(|a, b| comparar_versoes_loader_desc(&a.version, &b.version));
                versions
            } else {
                Vec::new()
            }
        }
        _ => {
            return Err(format!("Tipo de loader desconhecido: {}", loader_type));
        }
    };

    if versions.is_empty() {
        return Err(format!(
            "Nenhuma versão encontrada para o loader: {}",
            loader_type
        ));
    }

    Ok(LoaderVersionsResponse { versions })
}

fn comparar_versoes_loader_desc(a: &str, b: &str) -> std::cmp::Ordering {
    let componentes = |versao: &str| {
        versao
            .split(|caractere: char| !caractere.is_ascii_digit())
            .filter(|parte| !parte.is_empty())
            .filter_map(|parte| parte.parse::<u64>().ok())
            .collect::<Vec<_>>()
    };

    componentes(b).cmp(&componentes(a)).then_with(|| b.cmp(a))
}

fn prefixo_neoforge_para_minecraft(minecraft_version: &str) -> Option<String> {
    let partes = minecraft_version.trim().split('.').collect::<Vec<_>>();
    if partes.is_empty()
        || partes.iter().any(|parte| {
            parte.is_empty() || !parte.chars().all(|caractere| caractere.is_ascii_digit())
        })
    {
        return None;
    }

    if partes[0] == "1" {
        let minor = partes.get(1)?;
        let patch = partes.get(2).copied().unwrap_or("0");
        return Some(format!("{}.{}.", minor, patch));
    }

    let ciclo = partes.get(1)?;
    Some(format!("{}.{}.", partes[0], ciclo))
}

// ===== FUNÇÕES DE MODS E CONTEÚDO =====

fn extrair_build_forge(minecraft_version: &str, forge_version: &str) -> String {
    let versao = forge_version.trim();
    if versao.is_empty() {
        return versao.to_string();
    }

    if let Some(restante) = versao.strip_prefix(&format!("{}-", minecraft_version)) {
        return restante.to_string();
    }

    if let Some((prefixo, restante)) = versao.split_once('-') {
        if prefixo.starts_with("1.") && !restante.trim().is_empty() {
            return restante.trim().to_string();
        }
    }

    versao.to_string()
}

fn versao_forge_completa(minecraft_version: &str, forge_version: &str) -> String {
    let versao = forge_version.trim();
    if versao.starts_with(&format!("{}-", minecraft_version)) {
        return versao.to_string();
    }

    let build = extrair_build_forge(minecraft_version, versao);
    format!("{}-{}", minecraft_version, build)
}

pub(super) async fn install_forge_loader(
    instance_path: &std::path::Path,
    minecraft_version: &str,
    forge_version: &str,
) -> Result<(), String> {
    let versao_forge = versao_forge_completa(minecraft_version, forge_version);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;
    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar",
        versao_forge, versao_forge
    );

    let temp_dir = std::env::temp_dir().join(format!(
        "dome_launcher_forge_installer_{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let installer_path = temp_dir.join("forge-installer.jar");

    // Download do installer
    let response = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar instalador Forge: {}", e))?;
    if !response.status().is_success() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Falha ao baixar instalador Forge ({}): {}",
            response.status(),
            installer_url
        ));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&installer_path, bytes).map_err(|e| e.to_string())?;

    preparar_diretorio_launcher_para_instalador(instance_path, minecraft_version)?;

    let instance_str = instance_path
        .to_str()
        .ok_or_else(|| "Caminho da instância inválido.".to_string())?;

    let instalador_str = installer_path
        .to_str()
        .ok_or_else(|| "Caminho do instalador Forge inválido.".to_string())?;

    let java_cli =
        crate::comandos::configuracoes_java::ensure_java_cli_for_version(minecraft_version)
            .await
            .map_err(|e| format!("Erro ao obter Java para instalador Forge: {}", e))?;

    let mut comando_instalador = std::process::Command::new(&java_cli);
    #[cfg(target_os = "windows")]
    comando_instalador.creation_flags(CREATE_NO_WINDOW);
    let output = comando_instalador
        .args(["-jar", instalador_str, "--installClient", instance_str])
        .current_dir(instance_path)
        .output()
        .map_err(|e| {
            format!(
                "Erro ao executar instalador Forge com '{}': {}",
                java_cli, e
            )
        })?;

    if output.status.success() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detalhe = if !stderr.is_empty() { stderr } else { stdout };
    let _ = std::fs::remove_dir_all(temp_dir);
    Err(format!(
        "Falha ao instalar o perfil de cliente Forge (versão {}). {}",
        versao_forge, detalhe
    ))
}

pub(super) async fn install_fabric_loader(
    instance_path: &std::path::Path,
    minecraft_version: &str,
    fabric_version: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    println!(
        "[Fabric] Instalando Fabric {} para MC {}",
        fabric_version, minecraft_version
    );

    // Usar a API Meta do Fabric para obter o perfil completo
    let profile_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        minecraft_version, fabric_version
    );

    println!("[Fabric] Buscando perfil: {}", profile_url);

    let response = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar perfil Fabric: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Falha ao obter perfil Fabric: {}",
            response.status()
        ));
    }

    let fabric_profile: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear perfil Fabric: {}", e))?;

    // Salvar o perfil do Fabric para uso posterior
    let fabric_manifest_path = instance_path.join("fabric_manifest.json");
    std::fs::write(
        &fabric_manifest_path,
        serde_json::to_string_pretty(&fabric_profile).unwrap(),
    )
    .map_err(|e| format!("Erro ao salvar manifesto Fabric: {}", e))?;

    // Baixar bibliotecas do Fabric
    let libraries_path = instance_path.join("libraries");
    std::fs::create_dir_all(&libraries_path).map_err(|e| e.to_string())?;

    if let Some(libs) = fabric_profile["libraries"].as_array() {
        println!("[Fabric] Baixando {} bibliotecas...", libs.len());

        for lib in libs {
            if let Some(name) = lib["name"].as_str() {
                // Formato Maven: group:artifact:version
                // Exemplo: net.fabricmc:fabric-loader:0.16.14
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0].replace('.', "/");
                    let artifact = parts[1];
                    let version = parts[2];

                    // URL base (pode vir de lib["url"] ou usar Maven Central/Fabric Maven)
                    let base_url = lib["url"].as_str().unwrap_or("https://maven.fabricmc.net/");

                    let jar_path = format!(
                        "{}/{}/{}/{}-{}.jar",
                        group, artifact, version, artifact, version
                    );
                    let download_url = format!("{}{}", base_url, jar_path);

                    let local_path = libraries_path.join(&jar_path);

                    if !local_path.exists() {
                        // Criar diretório pai
                        if let Some(parent) = local_path.parent() {
                            std::fs::create_dir_all(parent).ok();
                        }

                        println!("[Fabric] Baixando: {}", artifact);
                        match client.get(&download_url).send().await {
                            Ok(res) => {
                                if res.status().is_success() {
                                    if let Ok(bytes) = res.bytes().await {
                                        std::fs::write(&local_path, bytes).ok();
                                    }
                                } else {
                                    // Tentar Maven Central como fallback
                                    let maven_central_url =
                                        format!("https://repo1.maven.org/maven2/{}", jar_path);
                                    if let Ok(res2) = client.get(&maven_central_url).send().await {
                                        if res2.status().is_success() {
                                            if let Ok(bytes) = res2.bytes().await {
                                                std::fs::write(&local_path, bytes).ok();
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("[Fabric] Falha ao baixar {}: {}", artifact, e);
                            }
                        }
                    }
                }
            }
        }
    }

    println!("[Fabric] Instalação concluída!");
    Ok(())
}

pub(super) async fn install_neoforge_loader(
    instance_path: &std::path::Path,
    minecraft_version: &str,
    neoforge_version: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))?;
    let installer_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/neoforge-{}-installer.jar",
        neoforge_version, neoforge_version
    );

    let temp_dir = std::env::temp_dir().join(format!(
        "dome_launcher_neoforge_installer_{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;

    let installer_path = temp_dir.join("neoforge-installer.jar");

    let response = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar instalador NeoForge: {}", e))?;
    if !response.status().is_success() {
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Falha ao baixar instalador NeoForge {}: {}",
            neoforge_version,
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler instalador NeoForge: {}", e))?;
    std::fs::write(&installer_path, bytes)
        .map_err(|e| format!("Erro ao salvar instalador NeoForge: {}", e))?;

    preparar_diretorio_launcher_para_instalador(instance_path, minecraft_version)?;

    let instance_str = instance_path
        .to_str()
        .ok_or_else(|| "Caminho da instância inválido.".to_string())?;
    let installer_str = installer_path
        .to_str()
        .ok_or_else(|| "Caminho do instalador NeoForge inválido.".to_string())?;

    let java_cli =
        crate::comandos::configuracoes_java::ensure_java_cli_for_version(minecraft_version)
            .await
            .map_err(|e| format!("Erro ao obter Java para instalador NeoForge: {}", e))?;

    let mut comando_instalador = std::process::Command::new(&java_cli);
    #[cfg(target_os = "windows")]
    comando_instalador.creation_flags(CREATE_NO_WINDOW);
    let output = comando_instalador
        .args(["-jar", installer_str, "--installClient", instance_str])
        .current_dir(instance_path)
        .output()
        .map_err(|e| {
            format!(
                "Erro ao executar instalador NeoForge com '{}': {}",
                java_cli, e
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detalhe = if !stderr.is_empty() { stderr } else { stdout };
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(format!(
            "Falha ao instalar NeoForge {} para Minecraft {}. {}",
            neoforge_version, minecraft_version, detalhe
        ));
    }

    let perfil_direto = instance_path
        .join("versions")
        .join(format!("neoforge-{}", neoforge_version))
        .join(format!("neoforge-{}.json", neoforge_version));

    let perfil_instalado = if perfil_direto.exists() {
        perfil_direto
    } else {
        let mut encontrado = None;
        if let Ok(entradas) = std::fs::read_dir(instance_path.join("versions")) {
            for entrada in entradas.flatten() {
                if entrada.path().is_dir() {
                    let nome = entrada.file_name().to_string_lossy().to_string();
                    if nome != minecraft_version
                        && (nome.contains("neoforge") || nome.contains(neoforge_version))
                    {
                        let json = entrada.path().join(format!("{}.json", nome));
                        if json.exists() {
                            encontrado = Some(json);
                            break;
                        }
                    }
                }
            }
        }
        match encontrado {
            Some(p) => p,
            None => {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return Err(format!(
                    "O instalador NeoForge terminou sem criar o perfil de cliente esperado: {}",
                    perfil_direto.display()
                ));
            }
        }
    };

    std::fs::copy(
        &perfil_instalado,
        instance_path.join("neoforge_manifest.json"),
    )
    .map_err(|e| format!("Erro ao salvar perfil NeoForge da instância: {}", e))?;

    let _ = std::fs::remove_dir_all(temp_dir);
    Ok(())
}

fn preparar_diretorio_launcher_para_instalador(
    instance_path: &std::path::Path,
    minecraft_version: &str,
) -> Result<(), String> {
    let versao_dir = instance_path.join("versions").join(minecraft_version);
    std::fs::create_dir_all(&versao_dir)
        .map_err(|e| format!("Erro ao preparar diretório da versão: {}", e))?;

    let manifesto_origem = instance_path.join("version_manifest.json");
    let manifesto_destino = versao_dir.join(format!("{}.json", minecraft_version));
    if manifesto_origem.exists() && !manifesto_destino.exists() {
        std::fs::copy(&manifesto_origem, &manifesto_destino)
            .map_err(|e| format!("Erro ao preparar manifesto para o instalador: {}", e))?;
    }

    let cliente_origem = instance_path.join("bin").join("client.jar");
    let cliente_destino = versao_dir.join(format!("{}.jar", minecraft_version));
    if cliente_origem.exists() && !cliente_destino.exists() {
        std::fs::copy(&cliente_origem, &cliente_destino)
            .map_err(|e| format!("Erro ao preparar cliente para o instalador: {}", e))?;
    }

    let launcher_profiles = instance_path.join("launcher_profiles.json");
    if !launcher_profiles.exists() {
        std::fs::write(&launcher_profiles, "{\"profiles\":{}}")
            .map_err(|e| format!("Erro ao preparar perfil do launcher: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn create_instance(
    state: State<'_, LauncherState>,
    name: String,
    version: String,
    mc_type: String,
    loader_type: Option<String>,
    loader_version: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    println!("=== INICIANDO CRIAÇÃO DE INSTÂNCIA ===");
    println!("Nome: {}, Versão: {}, Tipo: {}", name, version, mc_type);
    // Check Auth
    let account = state.account.lock().unwrap().clone();
    if account.is_none() {
        return Err("Você precisa estar logado para criar instâncias.".to_string());
    }

    let client = reqwest::Client::new();

    // 1. Buscar o manifesto para encontrar a URL da versão
    let res = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let manifest = res
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;

    let version_entry = manifest
        .versions
        .iter()
        .find(|v| v.id == version)
        .ok_or_else(|| "Versão não encontrada no manifesto".to_string())?;

    // 2. Buscar detalhes da versão
    let res = client
        .get(&version_entry.url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let details = res
        .json::<VersionDetail>()
        .await
        .map_err(|e| e.to_string())?;

    // 3. Preparar diretório
    let id = urlencoding::encode(&name.to_lowercase().replace(' ', "_")).to_string();
    let instance_path = caminho_instancia_por_id(&state, &id)?;
    if !instance_path.exists() {
        std::fs::create_dir_all(&instance_path).map_err(|e| e.to_string())?;
    }

    // 4. Baixar arquivos essenciais do Minecraft primeiro
    download_instance_files(&instance_path, &details).await?;

    // Salvar version_manifest.json antecipadamente para que instaladores de loader possam usá-lo
    let version_manifest_path = instance_path.join("version_manifest.json");
    let version_content = serde_json::to_string_pretty(&details).map_err(|e| e.to_string())?;
    std::fs::write(&version_manifest_path, version_content).map_err(|e| e.to_string())?;

    // 5. Instalar loader se especificado (agora que os arquivos já existem)
    let (loader_type_enum, loader_version_final) = if let Some(loader) = &loader_type {
        match loader.as_str() {
            "forge" => {
                if let Some(lv) = &loader_version {
                    install_forge_loader(&instance_path, &version, lv).await?;
                    (Some(LoaderType::Forge), Some(lv.clone()))
                } else {
                    return Err("Versão do Forge é obrigatória".to_string());
                }
            }
            "fabric" => {
                if let Some(lv) = &loader_version {
                    install_fabric_loader(&instance_path, &version, lv).await?;
                    (Some(LoaderType::Fabric), Some(lv.clone()))
                } else {
                    return Err("Versão do Fabric é obrigatória".to_string());
                }
            }
            "neoforge" => {
                if let Some(lv) = &loader_version {
                    install_neoforge_loader(&instance_path, &version, lv).await?;
                    (Some(LoaderType::NeoForge), Some(lv.clone()))
                } else {
                    return Err("Versão do NeoForge é obrigatória".to_string());
                }
            }
            "vanilla" => (None, None),
            _ => {
                return Err(format!(
                    "Loader '{}' não é suportado nesta versão do launcher.",
                    loader
                ))
            }
        }
    } else {
        (None, None)
    };

    // 5. Salvar registro
    let icon = match icon {
        Some(icon) => {
            super::instancias_basicas::validar_icone_instancia(&icon)?;
            icon
        }
        None => format!("https://api.dicebear.com/9.x/shapes/svg?seed={}", id),
    };
    let instance = Instance {
        id: id.clone(),
        name,
        version: version.clone(),
        mc_type,
        loader_type: Some(loader_type_enum.map_or_else(
            || "Vanilla".to_string(),
            |lt| match lt {
                LoaderType::Fabric => "Fabric".to_string(),
                LoaderType::Forge => "Forge".to_string(),
                LoaderType::NeoForge => "NeoForge".to_string(),
                LoaderType::Quilt => "Quilt".to_string(),
                LoaderType::Vanilla => "Vanilla".to_string(),
            },
        )),
        loader_version: loader_version_final,
        icon: Some(icon),
        created: chrono::Utc::now().to_rfc3339(),
        last_played: None,
        tempo_total_jogado_segundos: 0,
        sessao_iniciada_em: None,
        path: instance_path.clone(),
        java_args: None,
        mc_args: None,
        memory: None,
        width: None,
        height: None,
    };

    // Salvar instance.json
    let config_path = instance_path.join("instance.json");
    let content = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;

    // Salvar version_manifest.json (para uso no launch)
    let version_manifest_path = instance_path.join("version_manifest.json");
    let version_content = serde_json::to_string_pretty(&details).map_err(|e| e.to_string())?;
    std::fs::write(version_manifest_path, version_content).map_err(|e| e.to_string())?;

    super::sincronizacao_instancias::aplicar_sincronizacao_nova_instancia(&instance_path)?;

    // 6. Instância criada com os arquivos preparados para o primeiro launch
    println!("=== CRIAÇÃO DE INSTÂNCIA CONCLUÍDA COM SUCESSO ===");
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoMigracaoVersao {
    versao_anterior: String,
    versao_nova: String,
    mods_migrados: usize,
    mods_preservados_backup: Vec<String>,
    caminho_backup: String,
}

fn copiar_diretorio(origem: &std::path::Path, destino: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(destino)
        .map_err(|e| format!("Erro ao criar {}: {}", destino.display(), e))?;
    for entrada in
        std::fs::read_dir(origem).map_err(|e| format!("Erro ao ler {}: {}", origem.display(), e))?
    {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let caminho_origem = entrada.path();
        let caminho_destino = destino.join(entrada.file_name());
        if caminho_origem.is_dir() {
            copiar_diretorio(&caminho_origem, &caminho_destino)?;
        } else {
            std::fs::copy(&caminho_origem, &caminho_destino)
                .map_err(|e| format!("Erro ao copiar {}: {}", caminho_origem.display(), e))?;
        }
    }
    Ok(())
}

fn hash_sha512_arquivo(caminho: &std::path::Path) -> Result<String, String> {
    let bytes =
        std::fs::read(caminho).map_err(|e| format!("Erro ao ler {}: {}", caminho.display(), e))?;
    Ok(format!("{:x}", Sha512::digest(bytes)))
}

async fn identificar_mods_modrinth(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
) -> Result<Vec<(String, String, bool)>, String> {
    if !mods_dir.is_dir() {
        return Ok(Vec::new());
    }
    let pasta = mods_dir.to_path_buf();
    let hashes = tauri::async_runtime::spawn_blocking(move || {
        let arquivos = std::fs::read_dir(&pasta)
            .map_err(|e| format!("Erro ao listar mods: {}", e))?
            .flatten()
            .filter_map(|entrada| {
                let nome = entrada.file_name().to_string_lossy().to_string();
                let minusculo = nome.to_lowercase();
                (entrada.path().is_file()
                    && (minusculo.ends_with(".jar") || minusculo.ends_with(".jar.disabled")))
                .then_some((nome, entrada.path(), minusculo.ends_with(".disabled")))
            })
            .collect::<Vec<_>>();
        arquivos
            .into_iter()
            .map(|(nome, caminho, desabilitado)| {
                Ok((nome, hash_sha512_arquivo(&caminho)?, desabilitado))
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|e| format!("Falha ao analisar os mods: {}", e))??;
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let resposta = client
        .post(format!("{}/version_files", MODRINTH_API_BASE))
        .header("User-Agent", "DomeLauncher/1.0")
        .json(&serde_json::json!({
            "hashes": hashes.iter().map(|(_, hash, _)| hash).collect::<Vec<_>>(),
            "algorithm": "sha512"
        }))
        .send()
        .await
        .map_err(|e| format!("Erro ao identificar mods no Modrinth: {}", e))?;
    if !resposta.status().is_success() {
        return Err(format!(
            "Modrinth retornou {} ao identificar mods.",
            resposta.status()
        ));
    }
    let encontrados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida do Modrinth: {}", e))?;
    Ok(hashes
        .into_iter()
        .filter_map(|(nome, hash, desabilitado)| {
            encontrados[&hash]["project_id"]
                .as_str()
                .map(|id| (nome, id.to_string(), desabilitado))
        })
        .collect())
}

fn fingerprint_curseforge(caminho: &std::path::Path) -> Result<u32, String> {
    let bytes =
        std::fs::read(caminho).map_err(|e| format!("Erro ao ler {}: {}", caminho.display(), e))?;
    let normalizados = bytes
        .into_iter()
        .filter(|byte| !matches!(byte, 9 | 10 | 13 | 32))
        .collect::<Vec<_>>();
    let mut hash = 1u32 ^ normalizados.len() as u32;
    let constante = 0x5bd1e995u32;
    let (blocos, restante) = normalizados.as_chunks::<4>();
    for bloco in blocos {
        let mut valor = u32::from_le_bytes(*bloco);
        valor = valor.wrapping_mul(constante);
        valor ^= valor >> 24;
        valor = valor.wrapping_mul(constante);
        hash = hash.wrapping_mul(constante) ^ valor;
    }
    if restante.len() >= 3 {
        hash ^= (restante[2] as u32) << 16;
    }
    if restante.len() >= 2 {
        hash ^= (restante[1] as u32) << 8;
    }
    if let Some(primeiro) = restante.first() {
        hash ^= *primeiro as u32;
        hash = hash.wrapping_mul(constante);
    }
    hash ^= hash >> 13;
    hash = hash.wrapping_mul(constante);
    hash ^= hash >> 15;
    Ok(hash)
}

async fn identificar_mods_curseforge(
    client: &reqwest::Client,
    mods_dir: &std::path::Path,
) -> Result<Vec<(String, String, bool)>, String> {
    if !mods_dir.is_dir() {
        return Ok(Vec::new());
    }
    let pasta = mods_dir.to_path_buf();
    let fingerprints = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_dir(&pasta)
            .map_err(|e| format!("Erro ao listar mods: {}", e))?
            .flatten()
            .filter_map(|entrada| {
                let nome = entrada.file_name().to_string_lossy().to_string();
                let minusculo = nome.to_lowercase();
                (entrada.path().is_file()
                    && (minusculo.ends_with(".jar") || minusculo.ends_with(".jar.disabled")))
                .then_some((nome, entrada.path(), minusculo.ends_with(".disabled")))
            })
            .map(|(nome, caminho, desabilitado)| {
                Ok((nome, fingerprint_curseforge(&caminho)?, desabilitado))
            })
            .collect::<Result<Vec<_>, String>>()
    })
    .await
    .map_err(|e| format!("Falha ao analisar os mods: {}", e))??;
    if fingerprints.is_empty() {
        return Ok(Vec::new());
    }
    let resposta = super::anexar_headers_curseforge(
        client
            .post(format!("{}/fingerprints", super::CURSEFORGE_API_BASE))
            .json(&serde_json::json!({
                "fingerprints": fingerprints.iter().map(|(_, valor, _)| valor).collect::<Vec<_>>()
            })),
    )?
    .send()
    .await
    .map_err(|e| format!("Erro ao identificar mods no CurseForge: {}", e))?;
    if !resposta.status().is_success() {
        return Err(format!(
            "CurseForge retornou {} ao identificar mods.",
            resposta.status()
        ));
    }
    let payload = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida do CurseForge: {}", e))?;
    let encontrados = payload["data"]["exactMatches"]
        .as_array()
        .ok_or("CurseForge não retornou os resultados de identificação.")?;
    let projetos = encontrados
        .iter()
        .filter_map(|item| {
            Some((
                item["id"].as_u64()? as u32,
                item["file"]["modId"].as_u64()?.to_string(),
            ))
        })
        .collect::<std::collections::HashMap<_, _>>();
    Ok(fingerprints
        .into_iter()
        .filter_map(|(nome, fingerprint, desabilitado)| {
            projetos
                .get(&fingerprint)
                .cloned()
                .map(|id| (nome, id, desabilitado))
        })
        .collect())
}

#[tauri::command]
pub(crate) async fn migrar_versao_instancia(
    state: State<'_, LauncherState>,
    instance_id: String,
    version: String,
    loader_type: String,
    loader_version: Option<String>,
) -> Result<ResultadoMigracaoVersao, String> {
    let mut instancia = obter_instancia_por_id(&state, &instance_id)?;
    if instancia.path.join("modpack.json").exists() {
        return Err("Use a troca de versão do modpack para esta instância.".to_string());
    }
    let loader = loader_type.trim().to_lowercase();
    if !matches!(loader.as_str(), "vanilla" | "fabric" | "forge" | "neoforge") {
        return Err("Loader não suportado para migração.".to_string());
    }
    if version.trim().is_empty() {
        return Err("Selecione uma versão do Minecraft.".to_string());
    }
    if loader != "vanilla" && loader_version.as_deref().is_none_or(str::is_empty) {
        return Err("Selecione uma versão do loader.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("DomeLauncher/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let manifesto = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;
    let entrada = manifesto
        .versions
        .iter()
        .find(|item| item.id == version)
        .ok_or("Versão do Minecraft não encontrada.")?;
    let detalhes = client
        .get(&entrada.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<VersionDetail>()
        .await
        .map_err(|e| e.to_string())?;

    let temporario = instancia
        .path
        .with_file_name(format!(".dome-migracao-{}", uuid::Uuid::new_v4()));
    let origem_copia = instancia.path.clone();
    let destino_copia = temporario.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(erro) = copiar_diretorio(&origem_copia, &destino_copia) {
            let _ = std::fs::remove_dir_all(&destino_copia);
            return Err(erro);
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Falha ao copiar a instância para migração: {}", e))??;
    let mods_temporarios = temporario.join("mods");
    if mods_temporarios.exists() {
        std::fs::remove_dir_all(&mods_temporarios)
            .map_err(|e| format!("Erro ao preparar a migração dos mods: {}", e))?;
    }
    let preparar = async {
        download_instance_files(&temporario, &detalhes).await?;
        std::fs::write(
            temporario.join("version_manifest.json"),
            serde_json::to_string_pretty(&detalhes).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        match loader.as_str() {
            "fabric" => {
                install_fabric_loader(&temporario, &version, loader_version.as_deref().unwrap())
                    .await?
            }
            "forge" => {
                install_forge_loader(&temporario, &version, loader_version.as_deref().unwrap())
                    .await?
            }
            "neoforge" => {
                install_neoforge_loader(&temporario, &version, loader_version.as_deref().unwrap())
                    .await?
            }
            _ => {}
        }
        Ok::<(), String>(())
    }
    .await;
    if let Err(erro) = preparar {
        let _ = std::fs::remove_dir_all(&temporario);
        return Err(erro);
    }

    let mods_atuais = instancia.path.join("mods");
    let mods_identificados = match identificar_mods_modrinth(&client, &mods_atuais).await {
        Ok(mods) => mods,
        Err(erro) => {
            let _ = std::fs::remove_dir_all(&temporario);
            return Err(erro);
        }
    };
    let mods_curseforge = match identificar_mods_curseforge(&client, &mods_atuais).await {
        Ok(mods) => mods,
        Err(erro) => {
            let _ = std::fs::remove_dir_all(&temporario);
            return Err(erro);
        }
    };
    let mods_novos = temporario.join("mods");
    let loader_normalizado = (loader != "vanilla").then(|| loader.clone());
    let mut migrados = 0usize;
    let mut nomes_migrados = std::collections::HashSet::new();
    for (nome, project_id, desabilitado) in mods_identificados {
        if desabilitado {
            continue;
        }
        if super::mods_conteudo::instalar_mod_modrinth_compativel(
            &client,
            &mods_novos,
            project_id,
            &version,
            &loader_normalizado,
        )
        .await
        .is_ok()
        {
            migrados += 1;
            nomes_migrados.insert(nome);
        }
    }
    for (nome, project_id, desabilitado) in mods_curseforge {
        if desabilitado || nomes_migrados.contains(&nome) {
            continue;
        }
        if super::mods_conteudo::instalar_mod_curseforge_compativel(
            &client,
            &mods_novos,
            project_id,
            &version,
            &loader_normalizado,
        )
        .await
        .is_ok()
        {
            migrados += 1;
            nomes_migrados.insert(nome);
        }
    }

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let pasta_backups = crate::launcher::pasta_backups_instancias();
    std::fs::create_dir_all(&pasta_backups).map_err(|e| e.to_string())?;
    let backup = pasta_backups.join(format!("{}-versao-{}", instancia.id, timestamp));
    let mut preservados = Vec::new();
    if mods_atuais.is_dir() {
        preservados = std::fs::read_dir(&mods_atuais)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|entrada| entrada.file_name().to_string_lossy().to_string())
            .filter(|nome| !nomes_migrados.contains(nome))
            .collect();
    }

    let versao_anterior = instancia.version.clone();
    instancia.version = version.clone();
    instancia.mc_type = if loader == "vanilla" {
        "Vanilla".into()
    } else {
        "Modded".into()
    };
    instancia.loader_type = Some(
        match loader.as_str() {
            "fabric" => "Fabric",
            "forge" => "Forge",
            "neoforge" => "NeoForge",
            _ => "Vanilla",
        }
        .to_string(),
    );
    instancia.loader_version = if loader == "vanilla" {
        None
    } else {
        loader_version
    };
    std::fs::write(
        temporario.join("instance.json"),
        serde_json::to_string_pretty(&instancia).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    std::fs::rename(&instancia.path, &backup).map_err(|e| {
        format!(
            "Erro ao ativar a migração e guardar a versão anterior: {}",
            e
        )
    })?;
    if let Err(erro) = std::fs::rename(&temporario, &instancia.path) {
        let _ = std::fs::rename(&backup, &instancia.path);
        return Err(format!(
            "Erro ao ativar a nova versão; a anterior foi restaurada: {}",
            erro
        ));
    }

    Ok(ResultadoMigracaoVersao {
        versao_anterior,
        versao_nova: version,
        mods_migrados: migrados,
        mods_preservados_backup: preservados,
        caminho_backup: backup.to_string_lossy().to_string(),
    })
}

pub(super) use super::downloads_instancias::download_instance_files;

// ===== FUNÇÕES DE AJUSTE DE MANIFESTO PARA LOADERS =====

pub(super) async fn adjust_forge_manifest(
    details: &mut VersionDetail,
    forge_version: &str,
    instance_path: &std::path::Path,
) -> Result<(), String> {
    let versao_forge = versao_forge_completa(&details.id, forge_version);
    let forge_manifest_local = instance_path.join("forge_manifest.json");

    let mut forge_json_opt: Option<serde_json::Value> = None;

    // 1. Tentar ler forge_manifest.json salvo localmente na instância
    if forge_manifest_local.exists() {
        if let Ok(conteudo) = std::fs::read_to_string(&forge_manifest_local) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&conteudo) {
                forge_json_opt = Some(parsed);
            }
        }
    }

    // 2. Se não encontrou localmente, buscar do Maven (.json) ou do Installer JAR (version.json)
    if forge_json_opt.is_none() {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
            .build()
            .map_err(|e| e.to_string())?;

        // 2.1 Tentar Maven .json standalone (Forge legado ≤ 1.12.2)
        let forge_manifest_url = format!(
            "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}.json",
            versao_forge, versao_forge
        );

        if let Ok(resposta) = client.get(&forge_manifest_url).send().await {
            if resposta.status().is_success() {
                if let Ok(parsed) = resposta.json::<serde_json::Value>().await {
                    let _ = std::fs::write(
                        &forge_manifest_local,
                        serde_json::to_string_pretty(&parsed).unwrap_or_default(),
                    );
                    forge_json_opt = Some(parsed);
                }
            }
        }

        // 2.2 Tentar extrair version.json de dentro do installer JAR (Forge moderno 1.13+)
        if forge_json_opt.is_none() {
            println!(
                "[Forge] Buscando manifesto dentro do instalador Forge {}...",
                versao_forge
            );
            let installer_url = format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{}/forge-{}-installer.jar",
                versao_forge, versao_forge
            );

            if let Ok(resposta) = client.get(&installer_url).send().await {
                if resposta.status().is_success() {
                    if let Ok(bytes) = resposta.bytes().await {
                        if let Ok(mut arquivo_zip) =
                            zip::ZipArchive::new(std::io::Cursor::new(bytes))
                        {
                            if let Ok(mut entrada) = arquivo_zip.by_name("version.json") {
                                use std::io::Read;
                                let mut conteudo = String::new();
                                if entrada.read_to_string(&mut conteudo).is_ok() {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(&conteudo)
                                    {
                                        let _ = std::fs::write(&forge_manifest_local, &conteudo);
                                        forge_json_opt = Some(parsed);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Se obtivemos o manifesto do Forge, mesclar com o manifesto vanilla
    if let Some(fj) = forge_json_opt {
        if let Some(main_class) = fj.get("mainClass").and_then(|v| v.as_str()) {
            println!(
                "[Forge] Aplicando manifesto do Forge (main class: {})...",
                main_class
            );
            details.main_class = main_class.to_string();
        }

        // Adicionar bibliotecas do Forge
        let mut nomes_existentes: std::collections::HashSet<String> = details
            .libraries
            .iter()
            .map(|lib| lib.name.clone())
            .collect();

        if let Some(libs_arr) = fj.get("libraries").and_then(|v| v.as_array()) {
            for lib_val in libs_arr {
                let name = lib_val
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                if name.is_empty() || nomes_existentes.contains(&name) {
                    continue;
                }

                if let Ok(mut lib) =
                    serde_json::from_value::<crate::launcher::Library>(lib_val.clone())
                {
                    // Garantir que a biblioteca tenha um download path associado
                    if lib
                        .downloads
                        .as_ref()
                        .and_then(|d| d.artifact.as_ref())
                        .and_then(|a| a.path.as_ref())
                        .is_none()
                    {
                        let partes: Vec<&str> = name.split(':').collect();
                        if partes.len() >= 3 {
                            let grupo = partes[0].replace('.', "/");
                            let artefato = partes[1];
                            let versao = partes[2];
                            let caminho_jar = format!(
                                "{}/{}/{}/{}-{}.jar",
                                grupo, artefato, versao, artefato, versao
                            );
                            lib.downloads = Some(crate::launcher::LibraryDownloads {
                                artifact: Some(crate::launcher::Artifact {
                                    path: Some(caminho_jar.clone()),
                                    sha1: None,
                                    size: None,
                                    url: format!(
                                        "https://maven.minecraftforge.net/{}",
                                        caminho_jar
                                    ),
                                }),
                                classifiers: None,
                            });
                        }
                    }
                    details.libraries.push(lib);
                    nomes_existentes.insert(name);
                }
            }
        }

        // Mesclar argumentos JVM e Game do Forge
        if let Some(fd_args) = fj.get("arguments") {
            let details_args = details
                .arguments
                .get_or_insert_with(|| serde_json::json!({}));

            if let Some(obj) = details_args.as_object_mut() {
                if let Some(fd_jvm) = fd_args.get("jvm").and_then(|v| v.as_array()) {
                    let jvm_array = obj
                        .entry("jvm")
                        .or_insert_with(|| serde_json::Value::Array(Vec::new()))
                        .as_array_mut();
                    if let Some(arr) = jvm_array {
                        for arg in fd_jvm {
                            arr.push(arg.clone());
                        }
                    }
                }

                if let Some(fd_game) = fd_args.get("game").and_then(|v| v.as_array()) {
                    let game_array = obj
                        .entry("game")
                        .or_insert_with(|| serde_json::Value::Array(Vec::new()))
                        .as_array_mut();
                    if let Some(arr) = game_array {
                        for arg in fd_game {
                            arr.push(arg.clone());
                        }
                    }
                }
            }
        }

        // Verificar se os jars de cliente do Forge foram gerados (forge-*-client.jar)
        let forge_client_jar = instance_path
            .join("libraries")
            .join("net")
            .join("minecraftforge")
            .join("forge")
            .join(&versao_forge)
            .join(format!("forge-{}-client.jar", versao_forge));

        if !forge_client_jar.exists() {
            println!("[Forge] Jars do cliente Forge não encontrados. Executando instalação do cliente...");
            if let Err(e) = install_forge_loader(instance_path, &details.id, forge_version).await {
                eprintln!("[Forge] Aviso na instalação do loader: {}", e);
            }
        }

        return Ok(());
    }

    // 4. Último recurso: fallback legado para versões muito antigas sem installer
    println!("[Forge] Usando fallback legado para Forge antigo.");
    let build_forge = extrair_build_forge(&details.id, forge_version);
    details.main_class = "net.minecraft.launchwrapper.Launch".to_string();

    if let Some(args) = &mut details.arguments {
        if let Some(game_args) = args.get_mut("game") {
            if let Some(arr) = game_args.as_array_mut() {
                arr.push(serde_json::json!("--tweakClass"));
                arr.push(serde_json::json!(
                    "net.minecraftforge.fml.common.launcher.FMLTweaker"
                ));
                arr.push(serde_json::json!("--fml.forgeVersion"));
                arr.push(serde_json::json!(build_forge));
            }
        }
    } else if let Some(legacy) = &mut details.minecraft_arguments {
        if !legacy.contains("--tweakClass") {
            legacy.push_str(" --tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker");
        }
        if !legacy.contains("--fml.forgeVersion") {
            legacy.push_str(&format!(" --fml.forgeVersion {}", build_forge));
        }
    } else {
        details.minecraft_arguments = Some(format!(
            "--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker --fml.forgeVersion {}",
            build_forge
        ));
    }

    Ok(())
}

pub(super) async fn adjust_fabric_manifest(
    details: &mut VersionDetail,
    _fabric_version: &str,
    instance_path: &std::path::Path,
) -> Result<(), String> {
    // Carregar manifesto do Fabric
    let fabric_manifest_path = instance_path.join("fabric_manifest.json");

    if !fabric_manifest_path.exists() {
        return Err("Manifesto do Fabric não encontrado. Recrie a instância.".to_string());
    }

    let fabric_content = std::fs::read_to_string(&fabric_manifest_path)
        .map_err(|e| format!("Erro ao ler manifesto Fabric: {}", e))?;
    let fabric_profile: serde_json::Value = serde_json::from_str(&fabric_content)
        .map_err(|e| format!("Erro ao parsear manifesto Fabric: {}", e))?;

    // Atualizar main class do Fabric
    if let Some(main_class) = fabric_profile["mainClass"].as_str() {
        details.main_class = main_class.to_string();
    } else {
        details.main_class = "net.fabricmc.loader.impl.launch.knot.KnotClient".to_string();
    }

    // Adicionar bibliotecas do Fabric ao details
    if let Some(fabric_libs) = fabric_profile["libraries"].as_array() {
        let libraries_path = instance_path.join("libraries");

        // Coletar nomes de artifacts do Fabric para remover duplicatas do Minecraft
        let mut fabric_artifacts: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        for lib in fabric_libs {
            if let Some(name) = lib["name"].as_str() {
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    // Chave: group:artifact (sem versão)
                    let artifact_key = format!("{}:{}", parts[0], parts[1]);
                    fabric_artifacts.insert(artifact_key);
                }
            }
        }

        // Remover bibliotecas do Minecraft que serão substituídas pelo Fabric
        details.libraries.retain(|lib| {
            let parts: Vec<&str> = lib.name.split(':').collect();
            if parts.len() >= 2 {
                let artifact_key = format!("{}:{}", parts[0], parts[1]);
                if fabric_artifacts.contains(&artifact_key) {
                    println!("[Fabric] Substituindo biblioteca: {}", lib.name);
                    return false; // Remover do Minecraft
                }
            }
            true // Manter
        });

        // Agora adicionar bibliotecas do Fabric
        for lib in fabric_libs {
            if let Some(name) = lib["name"].as_str() {
                // Formato Maven: group:artifact:version
                let parts: Vec<&str> = name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0].replace('.', "/");
                    let artifact = parts[1];
                    let version = parts[2];

                    let jar_path = format!(
                        "{}/{}/{}/{}-{}.jar",
                        group, artifact, version, artifact, version
                    );

                    let full_path = libraries_path.join(&jar_path);

                    // Criar uma nova entrada de biblioteca
                    let new_lib = crate::launcher::Library {
                        name: name.to_string(),
                        rules: None,
                        downloads: Some(crate::launcher::LibraryDownloads {
                            artifact: Some(crate::launcher::Artifact {
                                path: Some(jar_path),
                                url: lib["url"]
                                    .as_str()
                                    .map(|u| {
                                        format!(
                                            "{}{}/{}/{}/{}-{}.jar",
                                            u, group, artifact, version, artifact, version
                                        )
                                    })
                                    .unwrap_or_default(),
                                sha1: None,
                                size: None,
                            }),
                            classifiers: None,
                        }),
                        natives: None,
                    };

                    // Adicionar apenas se o arquivo existe
                    if full_path.exists() {
                        details.libraries.push(new_lib);
                    }
                }
            }
        }
    }

    // Adicionar argumentos do Fabric (se existirem no manifesto)
    if let Some(args) = fabric_profile["arguments"].as_object() {
        if let Some(jvm_args) = args.get("jvm") {
            if let Some(jvm_arr) = jvm_args.as_array() {
                if let Some(details_args) = &mut details.arguments {
                    if let Some(details_jvm) = details_args.get_mut("jvm") {
                        if let Some(arr) = details_jvm.as_array_mut() {
                            for arg in jvm_arr {
                                arr.push(arg.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    println!(
        "[Fabric] Manifesto ajustado - {} bibliotecas adicionadas",
        details.libraries.len()
    );
    Ok(())
}

pub(super) async fn adjust_neoforge_manifest(
    details: &mut VersionDetail,
    neoforge_version: &str,
    instance_path: &std::path::Path,
) -> Result<(), String> {
    let manifesto_path = instance_path.join("neoforge_manifest.json");
    let id_esperado = format!("neoforge-{}", neoforge_version);
    let precisa_instalar = if manifesto_path.exists() {
        let conteudo = std::fs::read_to_string(&manifesto_path)
            .map_err(|e| format!("Erro ao ler perfil NeoForge: {}", e))?;
        let perfil: serde_json::Value = serde_json::from_str(&conteudo)
            .map_err(|e| format!("Perfil NeoForge inválido: {}", e))?;
        perfil.get("id").and_then(|id| id.as_str()) != Some(id_esperado.as_str())
    } else {
        true
    };

    if precisa_instalar {
        println!(
            "[NeoForge] Perfil de cliente ausente ou desatualizado. Instalando {} para Minecraft {}...",
            neoforge_version, details.id
        );
        install_neoforge_loader(instance_path, &details.id, neoforge_version).await?;
    }

    let conteudo = std::fs::read_to_string(&manifesto_path)
        .map_err(|e| format!("Erro ao ler perfil NeoForge instalado: {}", e))?;
    let perfil: serde_json::Value = serde_json::from_str(&conteudo)
        .map_err(|e| format!("Erro ao interpretar perfil NeoForge: {}", e))?;

    mesclar_perfil_loader(
        details,
        &perfil,
        "NeoForge",
        "https://maven.neoforged.net/releases/",
    )
}

fn mesclar_perfil_loader(
    details: &mut VersionDetail,
    perfil: &serde_json::Value,
    nome_loader: &str,
    repositorio_padrao: &str,
) -> Result<(), String> {
    let main_class = perfil
        .get("mainClass")
        .and_then(|valor| valor.as_str())
        .filter(|valor| !valor.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "Perfil {} não contém uma classe principal válida.",
                nome_loader
            )
        })?;
    details.main_class = main_class.to_string();

    let mut nomes_existentes: std::collections::HashSet<String> = details
        .libraries
        .iter()
        .map(|biblioteca| biblioteca.name.clone())
        .collect();

    if let Some(bibliotecas) = perfil.get("libraries").and_then(|valor| valor.as_array()) {
        for biblioteca_json in bibliotecas {
            let Some(nome) = biblioteca_json.get("name").and_then(|valor| valor.as_str()) else {
                continue;
            };
            if nomes_existentes.contains(nome) {
                continue;
            }

            let mut biblioteca: crate::launcher::Library =
                serde_json::from_value(biblioteca_json.clone()).map_err(|e| {
                    format!(
                        "Biblioteca inválida no perfil {} ({}): {}",
                        nome_loader, nome, e
                    )
                })?;
            if biblioteca
                .downloads
                .as_ref()
                .and_then(|downloads| downloads.artifact.as_ref())
                .and_then(|artefato| artefato.path.as_ref())
                .is_none()
            {
                biblioteca.downloads = criar_download_maven(nome, repositorio_padrao);
            }

            details.libraries.push(biblioteca);
            nomes_existentes.insert(nome.to_string());
        }
    }

    if let Some(argumentos_perfil) = perfil.get("arguments").and_then(|valor| valor.as_object()) {
        let argumentos = details
            .arguments
            .get_or_insert_with(|| serde_json::json!({}));
        let argumentos = argumentos
            .as_object_mut()
            .ok_or_else(|| "Argumentos da versão base estão em formato inválido.".to_string())?;

        for tipo in ["jvm", "game"] {
            let Some(novos) = argumentos_perfil
                .get(tipo)
                .and_then(|valor| valor.as_array())
            else {
                continue;
            };
            let atuais = argumentos
                .entry(tipo)
                .or_insert_with(|| serde_json::Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| format!("Argumentos {} da versão base são inválidos.", tipo))?;
            atuais.extend(novos.iter().cloned());
        }
    }

    println!(
        "[{}] Perfil de cliente aplicado (main class: {}, {} bibliotecas).",
        nome_loader,
        details.main_class,
        details.libraries.len()
    );
    Ok(())
}

fn criar_download_maven(
    coordenada: &str,
    repositorio_padrao: &str,
) -> Option<crate::launcher::LibraryDownloads> {
    let (coordenada, extensao) = coordenada.split_once('@').unwrap_or((coordenada, "jar"));
    let partes: Vec<&str> = coordenada.split(':').collect();
    if partes.len() < 3 {
        return None;
    }

    let grupo = partes[0].replace('.', "/");
    let artefato = partes[1];
    let versao = partes[2];
    let classificador = partes
        .get(3)
        .map(|valor| format!("-{}", valor))
        .unwrap_or_default();
    let caminho = format!(
        "{}/{}/{}/{}-{}{}.{}",
        grupo, artefato, versao, artefato, versao, classificador, extensao
    );
    let repositorio = repositorio_padrao.trim_end_matches('/');

    Some(crate::launcher::LibraryDownloads {
        artifact: Some(crate::launcher::Artifact {
            path: Some(caminho.clone()),
            sha1: None,
            size: None,
            url: format!("{}/{}", repositorio, caminho),
        }),
        classifiers: None,
    })
}

fn substituir_placeholders_jvm(
    arg: &str,
    natives_path: &std::path::Path,
    libraries_path: &std::path::Path,
    classpath: &str,
    version_id: &str,
) -> String {
    let mut res = arg
        .replace("${natives_directory}", &natives_path.to_string_lossy())
        .replace("${library_directory}", &libraries_path.to_string_lossy())
        .replace("${classpath_separator}", ";")
        .replace("${classpath}", classpath)
        .replace("${launcher_name}", "DomeLauncher")
        .replace("${launcher_version}", env!("CARGO_PKG_VERSION"))
        .replace("${version_name}", version_id);

    // O Forge espera ignorar o jar vanilla do jogo pelo nome. Como usamos client.jar,
    // precisamos adicioná-lo ao ignoreList para evitar colisão de módulos Java 17.
    if res.starts_with("-DignoreList=") && !res.contains("client.jar") {
        res.push_str(",client.jar,client");
    }

    res
}

pub(super) fn coletar_argumentos_jvm_manifesto(
    details: &VersionDetail,
    natives_path: &std::path::Path,
    libraries_path: &std::path::Path,
    classpath: &str,
) -> Vec<String> {
    let mut args_jvm = Vec::new();
    let mut ignorar_proximo_classpath = false;

    let Some(arguments) = &details.arguments else {
        return args_jvm;
    };
    let Some(jvm_args) = arguments.get("jvm").and_then(|v| v.as_array()) else {
        return args_jvm;
    };

    for valor in jvm_args {
        let Some(arg_raw) = valor.as_str() else {
            continue;
        };

        let arg_raw_trim = arg_raw.trim();
        if ignorar_proximo_classpath {
            ignorar_proximo_classpath = false;
            continue;
        }

        // O classpath é montado manualmente pelo launcher.
        if arg_raw_trim == "-cp" || arg_raw_trim == "-classpath" {
            ignorar_proximo_classpath = true;
            continue;
        }
        if arg_raw_trim == "${classpath}" {
            continue;
        }

        let mut arg = substituir_placeholders_jvm(
            arg_raw,
            natives_path,
            libraries_path,
            classpath,
            &details.id,
        )
        .trim()
        .to_string();

        if arg.starts_with("-DFabricMcEmu=") {
            let valor = arg["-DFabricMcEmu=".len()..].trim();
            arg = format!("-DFabricMcEmu={}", valor);
        }

        // Ignorar parâmetros já controlados pelo launcher.
        if arg.is_empty()
            || arg == "-cp"
            || arg == "-classpath"
            || arg == classpath
            || arg.starts_with("-Djava.library.path=")
            || arg.starts_with("-Xmx")
            || arg.starts_with("-Xms")
        {
            continue;
        }

        // Se ainda restou placeholder não resolvido, evita quebrar o launch.
        if arg.contains("${") {
            continue;
        }

        args_jvm.push(arg);
    }

    args_jvm
}

#[cfg(test)]
mod testes {
    use super::prefixo_neoforge_para_minecraft;

    #[test]
    fn converte_versoes_classicas_para_prefixo_neoforge() {
        assert_eq!(
            prefixo_neoforge_para_minecraft("1.21.1"),
            Some("21.1.".to_string())
        );
        assert_eq!(
            prefixo_neoforge_para_minecraft("1.21"),
            Some("21.0.".to_string())
        );
    }

    #[test]
    fn converte_versoes_anuais_sem_misturar_ciclos() {
        assert_eq!(
            prefixo_neoforge_para_minecraft("26.1"),
            Some("26.1.".to_string())
        );
        assert_eq!(
            prefixo_neoforge_para_minecraft("26.2.1"),
            Some("26.2.".to_string())
        );
    }

    #[test]
    fn rejeita_versoes_invalidas() {
        assert_eq!(prefixo_neoforge_para_minecraft("26"), None);
        assert_eq!(prefixo_neoforge_para_minecraft("26.x"), None);
        assert_eq!(prefixo_neoforge_para_minecraft(""), None);
    }
}
