use super::*;

pub(crate) fn timestamp_atual_segundos() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Extrai bibliotecas nativas dos classifiers para a pasta de natives.
fn extrair_natives_de_libs(
    libs: &[crate::launcher::Library],
    libraries_path: &std::path::Path,
    natives_path: &std::path::Path,
) {
    let nome_nativos = crate::launcher::nome_classifier_nativos();
    let extensao_nativos = crate::launcher::extensao_nativos();
    for lib in libs {
        if let Some(downloads) = &lib.downloads {
            if let Some(classifiers) = &downloads.classifiers {
                if let Some(native_obj) = classifiers.get(nome_nativos) {
                    if let Some(path) = native_obj["path"].as_str() {
                        let native_jar_path = libraries_path.join(path);
                        if native_jar_path.exists() {
                            if let Ok(file) = std::fs::File::open(&native_jar_path) {
                                if let Ok(mut archive) = zip::ZipArchive::new(file) {
                                    for i in 0..archive.len() {
                                        if let Ok(mut entry) = archive.by_index(i) {
                                            let name = entry.name().to_string();
                                            if name.ends_with(&format!(".{}", extensao_nativos)) {
                                                let out = natives_path.join(
                                                    std::path::Path::new(&name)
                                                        .file_name()
                                                        .unwrap(),
                                                );
                                                if let Ok(mut out_file) =
                                                    std::fs::File::create(&out)
                                                {
                                                    std::io::copy(&mut entry, &mut out_file).ok();
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

async fn obter_conta_valida_para_launch(
    state: &LauncherState,
) -> Result<crate::launcher::MinecraftAccount, String> {
    let conta_atual = {
        let lock = state
            .account
            .lock()
            .map_err(|_| "Falha ao acessar sessão atual.".to_string())?;
        lock.clone()
            .ok_or("Você precisa estar logado para jogar.".to_string())?
    };

    let agora = timestamp_atual_segundos();
    let margem_refresh_segundos = 5 * 60;
    let precisa_refresh = conta_atual.refresh_token.is_some()
        && match conta_atual.expires_at {
            Some(expira_em) => agora.saturating_add(margem_refresh_segundos) >= expira_em,
            None => true,
        };

    if precisa_refresh {
        match crate::auth::refresh_token_interno(state).await {
            Ok(conta_renovada) => {
                println!("[Auth] Token renovado automaticamente antes do launch.");
                return Ok(conta_renovada);
            }
            Err(erro) => {
                eprintln!("[Auth] Falha ao renovar token antes do launch: {}", erro);
                let expirado = conta_atual
                    .expires_at
                    .map(|expira_em| agora >= expira_em)
                    .unwrap_or(false);
                let exige_novo_login = erro.to_lowercase().contains("faça login novamente");
                if expirado || exige_novo_login {
                    return Err(
                        "Sua sessão expirou e não foi possível renová-la. Faça login novamente."
                            .to_string(),
                    );
                }
            }
        }
    }

    if conta_atual.refresh_token.is_none()
        && conta_atual
            .expires_at
            .map(|expira_em| agora >= expira_em)
            .unwrap_or(false)
    {
        return Err("Sua sessão expirou. Faça login novamente.".to_string());
    }

    Ok(conta_atual)
}

async fn launch_instance_com_opcoes(
    state: &LauncherState,
    id: String,
    quick_play_servidor: Option<String>,
) -> Result<(), String> {
    let account = obter_conta_valida_para_launch(state).await?;

    let instance_path = caminho_instancia_por_id(state, &id)?;
    super::sincronizacao_instancias::aplicar_sincronizacao_antes_de_jogar(&instance_path)?;

    // 0. Carregar informações da instância
    let instance_config_path = instance_path.join("instance.json");
    if !instance_config_path.exists() {
        return Err("Configuração da instância não encontrada.".to_string());
    }
    let instance_content =
        std::fs::read_to_string(&instance_config_path).map_err(|e| e.to_string())?;
    let mut instance: Instance =
        serde_json::from_str(&instance_content).map_err(|e| e.to_string())?;

    let bin_path = instance_path.join("bin");
    let jar_path = bin_path.join("client.jar");
    let libraries_path = instance_path.join("libraries");
    let assets_path = instance_path.join("assets");
    let natives_path = bin_path.join("natives");

    // 1. Carregar Manifesto
    let version_manifest_path = instance_path.join("version_manifest.json");
    if !version_manifest_path.exists() {
        return Err("Manifesto da versão não encontrado.".to_string());
    }
    let content = std::fs::read_to_string(version_manifest_path).map_err(|e| e.to_string())?;
    let mut details: VersionDetail = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Normalizar loader com fallback para mc_type e comparação case-insensitive.
    let loader_normalizado = detectar_loader_normalizado(Some(
        instance
            .loader_type
            .as_deref()
            .filter(|valor| !valor.trim().is_empty())
            .unwrap_or(instance.mc_type.as_str()),
    ));

    // 1.1. Ajustar manifesto baseado no loader
    if let Some(loader_tipo) = loader_normalizado.as_deref() {
        match loader_tipo {
            "forge" => {
                super::instancias_criacao::adjust_forge_manifest(
                    &mut details,
                    instance
                        .loader_version
                        .as_ref()
                        .unwrap_or(&"latest".to_string()),
                    &instance_path,
                )
                .await?;
            }
            "fabric" => {
                super::instancias_criacao::adjust_fabric_manifest(
                    &mut details,
                    instance
                        .loader_version
                        .as_ref()
                        .unwrap_or(&"latest".to_string()),
                    &instance_path,
                )
                .await?;
            }
            "neoforge" => {
                super::instancias_criacao::adjust_neoforge_manifest(
                    &mut details,
                    instance
                        .loader_version
                        .as_ref()
                        .unwrap_or(&"latest".to_string()),
                    &instance_path,
                )
                .await?;
            }
            _ => {}
        }
    }

    // 1.2. Garantir que client.jar, bibliotecas e assets estejam presentes
    super::instancias_criacao::download_instance_files(&instance_path, &details).await?;

    // 2. Extrair Natives e Montar Classpath
    std::fs::create_dir_all(&natives_path).map_err(|e| e.to_string())?;

    // Extrair DLLs nativas de todas as libs do manifesto
    extrair_natives_de_libs(&details.libraries, &libraries_path, &natives_path);

    // 3. Detectar Java correto automaticamente
    let java_major_manifesto = details.java_version.as_ref().map(|java| java.major_version);
    let java_exe = crate::comandos::configuracoes_java::ensure_java_for_manifest(
        details.id.clone(),
        java_major_manifesto,
    )
    .await
    .map_err(|erro| format!("Não foi possível preparar o Java da instância: {}", erro))?;

    // 4. Carregar configurações globais
    let settings = crate::comandos::configuracoes_java::get_settings()
        .await
        .unwrap_or_default();

    // 5. Montar Argumentos (respeitar config da instância ou global)
    let mut args = Vec::new();

    let ram_mb = instance.memory.unwrap_or(settings.ram_mb);
    args.push(format!("-Xmx{}M", ram_mb));
    args.push(format!("-Xms{}M", (ram_mb / 2).max(512)));

    // JVM args customizados (instância ou global)
    if let Some(ref custom_args) = instance.java_args {
        for arg in custom_args.split_whitespace() {
            args.push(arg.to_string());
        }
    } else if !settings.java_args.is_empty() {
        for arg in settings.java_args.split_whitespace() {
            args.push(arg.to_string());
        }
    }

    // 5.1 Montar Classpath a partir das bibliotecas do manifesto
    let mut cp = Vec::new();

    let sistema_atual = crate::launcher::nome_sistema_minecraft();
    for lib in &details.libraries {
        let mut allowed = true;
        if let Some(rules) = &lib.rules {
            for rule in rules {
                if rule.action == "allow" {
                    if let Some(os) = &rule.os {
                        if os.name != sistema_atual {
                            allowed = false;
                        }
                    }
                } else if rule.action == "disallow" {
                    if let Some(os) = &rule.os {
                        if os.name == sistema_atual {
                            allowed = false;
                        }
                    }
                }
            }
        }

        if allowed {
            if let Some(downloads) = &lib.downloads {
                if let Some(artifact) = &downloads.artifact {
                    if let Some(path) = &artifact.path {
                        let full_path = libraries_path.join(path);
                        if full_path.exists() {
                            let path_str = full_path.to_string_lossy().to_string();
                            if !cp.contains(&path_str) {
                                cp.push(path_str);
                            }
                        }
                    }
                }
            }
        }
    }

    cp.push(jar_path.to_string_lossy().to_string());
    let cp_val = cp.join(crate::launcher::separador_classpath());

    // 5.2 Adicionar JVM args do manifesto (Fabric/Forge/NeoForge), com placeholders resolvidos
    for arg in super::instancias_criacao::coletar_argumentos_jvm_manifesto(
        &details,
        &natives_path,
        &libraries_path,
        &cp_val,
    ) {
        args.push(arg);
    }

    args.push(format!(
        "-Djava.library.path={}",
        natives_path.to_string_lossy()
    ));
    args.push("-cp".to_string());
    args.push(cp_val);
    args.push(details.main_class.clone());

    // 5.3 Montar Game args (vanilla + loader)
    let game_args_raw: Vec<String> = if let Some(modern_args) = &details.arguments {
        if let Some(game) = modern_args.get("game") {
            game.as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    } else if let Some(legacy) = &details.minecraft_arguments {
        legacy.split_whitespace().map(|s| s.to_string()).collect()
    } else {
        Vec::new()
    };

    // Resolução da janela
    let width = instance.width.unwrap_or(settings.width);
    let height = instance.height.unwrap_or(settings.height);

    for arg in &game_args_raw {
        let replaced = arg
            .replace("${auth_player_name}", &account.name)
            .replace("${version_name}", &details.id)
            .replace("${game_directory}", &instance_path.to_string_lossy())
            .replace("${assets_root}", &assets_path.to_string_lossy())
            .replace("${assets_index_name}", &details.asset_index.id)
            .replace("${auth_uuid}", &account.uuid)
            .replace("${auth_access_token}", &account.access_token)
            .replace("${clientid}", "")
            .replace("${client_id}", "")
            .replace("${auth_xuid}", "")
            .replace("${user_properties}", "{}")
            .replace("${user_type}", "msa")
            .replace("${version_type}", "release")
            .replace("${resolution_width}", &width.to_string())
            .replace("${resolution_height}", &height.to_string());

        args.push(replaced);
    }

    if let Some(endereco_servidor) = quick_play_servidor {
        let endereco_servidor = endereco_servidor.trim();
        if !endereco_servidor.is_empty()
            && !args
                .iter()
                .any(|a| a.eq_ignore_ascii_case("--quickPlayMultiplayer"))
        {
            args.push("--quickPlayMultiplayer".to_string());
            args.push(endereco_servidor.to_string());
        }
    }

    println!("[Launch] Executando: {} {:?}", java_exe, args);

    // Atualizar início da sessão antes de iniciar o jogo.
    let agora = chrono::Utc::now().to_rfc3339();
    instance.last_played = Some(agora.clone());
    instance.sessao_iniciada_em = Some(agora);
    if let Ok(instance_json) = serde_json::to_string_pretty(&instance) {
        if let Err(e) = std::fs::write(&instance_config_path, instance_json) {
            eprintln!(
                "[Launch] Aviso: falha ao salvar início de sessão em {:?}: {}",
                instance_config_path, e
            );
        }
    }

    let mut comando_java = std::process::Command::new(&java_exe);
    comando_java.args(&args).current_dir(&instance_path);
    let processo_iniciado: std::process::Child;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // Garante que o Minecraft permaneça aberto mesmo após fechar o launcher.
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        comando_java.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);

        processo_iniciado = match comando_java.spawn() {
            Ok(child) => child,
            Err(erro) if erro.raw_os_error() == Some(5) => {
                eprintln!(
                    "[Launch] Aviso: criação destacada bloqueada (acesso negado). Tentando fallback padrão."
                );

                let mut comando_fallback = std::process::Command::new(&java_exe);
                comando_fallback.args(&args).current_dir(&instance_path);
                comando_fallback.spawn().map_err(|e| {
                    format!(
                        "Falha ao iniciar Java ({}): {}. Verifique suas configurações de Java.",
                        java_exe, e
                    )
                })?
            }
            Err(erro) => {
                return Err(format!(
                    "Falha ao iniciar Java ({}): {}. Verifique suas configurações de Java.",
                    java_exe, erro
                ))
            }
        };
    }

    #[cfg(not(windows))]
    {
        processo_iniciado = comando_java.spawn().map_err(|e| {
            format!(
                "Falha ao iniciar Java ({}): {}. Verifique suas configurações de Java.",
                java_exe, e
            )
        })?;
    }

    state.iniciar_monitoramento_processo(&id, processo_iniciado);

    Ok(())
}

#[tauri::command]
pub(crate) async fn launch_instance(
    state: State<'_, LauncherState>,
    id: String,
) -> Result<(), String> {
    launch_instance_com_opcoes(&state, id, None).await
}

#[tauri::command]
pub(crate) async fn launch_instance_to_server(
    state: State<'_, LauncherState>,
    id: String,
    address: String,
) -> Result<(), String> {
    launch_instance_com_opcoes(&state, id, Some(address)).await
}
