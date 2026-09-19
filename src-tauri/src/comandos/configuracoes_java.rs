use serde::{Deserialize, Serialize};
use tauri::State;

use crate::launcher::LauncherState;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ===== GERENCIAMENTO AUTOMÁTICO DE JAVA =====
// Inspirado no HeliosLauncher (JavaGuard): detecta instalações, valida versões,
// baixa do Adoptium automaticamente quando necessário

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct JavaInfo {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub vendor: String,
    pub arch: String,
    pub is_managed: bool, // true = instalado pelo launcher
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct GlobalSettings {
    pub ram_mb: u32,
    pub java_path: Option<String>,
    pub java_args: String,
    pub width: u32,
    pub height: u32,
    pub auto_java: bool,       // gerenciamento automático de Java
    pub close_on_launch: bool, // fechar launcher ao iniciar jogo
    pub show_snapshots: bool,  // mostrar snapshots na lista de versões
    pub discord_rpc_ativo: bool,
    pub cor_destaque: String,
    pub instances_path: String,
    pub sincronizacao_instancias: ConfiguracaoSincronizacaoInstancias,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct ConfiguracaoSincronizacaoInstancias {
    pub instancia_origem_id: Option<String>,
    pub configuracoes: bool,
    pub opcoes: bool,
    pub texturas: bool,
    pub shaders: bool,
    pub servidores: bool,
}

impl Default for GlobalSettings {
    fn default() -> Self {
        // Detectar RAM total do sistema para sugerir um padrão razoável
        let total_ram_mb = {
            let sys = sysinfo::System::new_with_specifics(
                sysinfo::RefreshKind::new().with_memory(sysinfo::MemoryRefreshKind::everything()),
            );
            (sys.total_memory() / 1024 / 1024) as u32
        };
        // Padrão: 25% da RAM, mínimo 2GB, máximo 8GB
        let default_ram = (total_ram_mb / 4).clamp(2048, 8192);

        Self {
            ram_mb: default_ram,
            java_path: None,
            java_args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200"
                .to_string(),
            width: 854,
            height: 480,
            auto_java: true,
            close_on_launch: false,
            show_snapshots: false,
            discord_rpc_ativo: true,
            cor_destaque: "#10B981".to_string(),
            instances_path: get_default_instances_path().to_string_lossy().to_string(),
            sincronizacao_instancias: ConfiguracaoSincronizacaoInstancias::default(),
        }
    }
}

pub fn get_default_instances_path() -> std::path::PathBuf {
    crate::launcher::pasta_dados_launcher().join("instances")
}

fn get_settings_path() -> std::path::PathBuf {
    crate::launcher::pasta_dados_launcher().join("settings.json")
}

fn get_runtime_dir() -> std::path::PathBuf {
    crate::launcher::pasta_dados_launcher().join("runtime")
}

pub fn carregar_configuracoes_locais() -> Result<GlobalSettings, String> {
    let path = get_settings_path();
    if !path.exists() {
        return Ok(GlobalSettings::default());
    }

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Erro ao ler configurações: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Erro ao parsear configurações: {}", e))
}

fn validar_cor_destaque(cor: &str) -> Result<(), String> {
    let hexadecimal = cor.strip_prefix('#').unwrap_or_default();
    if hexadecimal.len() == 6
        && hexadecimal
            .chars()
            .all(|caractere| caractere.is_ascii_hexdigit())
    {
        return Ok(());
    }

    Err("A cor de destaque deve usar o formato hexadecimal #RRGGBB".to_string())
}

fn preparar_diretorio_instancias(caminho: &str) -> Result<(), String> {
    let caminho = std::path::PathBuf::from(caminho.trim());
    if caminho.as_os_str().is_empty() || !caminho.is_absolute() {
        return Err("Selecione um caminho absoluto para a pasta de instâncias".to_string());
    }
    if caminho.exists() && !caminho.is_dir() {
        return Err("O caminho selecionado não é uma pasta".to_string());
    }

    std::fs::create_dir_all(&caminho)
        .map_err(|e| format!("Não foi possível preparar a pasta de instâncias: {}", e))
}

#[tauri::command]
pub async fn get_settings() -> Result<GlobalSettings, String> {
    carregar_configuracoes_locais()
}

#[tauri::command]
pub async fn save_settings(
    settings: GlobalSettings,
    state: State<'_, LauncherState>,
) -> Result<(), String> {
    validar_cor_destaque(&settings.cor_destaque)?;
    preparar_diretorio_instancias(&settings.instances_path)?;
    let novo_caminho_instancias = std::path::PathBuf::from(settings.instances_path.trim());

    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Erro ao serializar: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Erro ao salvar: {}", e))?;
    state.atualizar_caminho_instancias(novo_caminho_instancias)?;
    Ok(())
}

#[tauri::command]
pub async fn get_system_ram() -> Result<u32, String> {
    let sys = sysinfo::System::new_with_specifics(
        sysinfo::RefreshKind::new().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    Ok((sys.total_memory() / 1024 / 1024) as u32)
}

/// Tenta encontrar o executável do Java no PATH do sistema operacional
pub fn resolver_caminho_java_do_path() -> Option<std::path::PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&paths) {
            let exe = p.join(nome_executavel_java(true));
            if exe.is_file() {
                return Some(exe);
            }
            #[cfg(target_os = "windows")]
            {
                let exe_w = p.join("javaw.exe");
                if exe_w.is_file() {
                    return Some(exe_w);
                }
            }
        }
    }
    None
}

/// Nome do executável Java (com extensão no Windows) conforme o sistema.
fn nome_executavel_java(console: bool) -> &'static str {
    if cfg!(windows) {
        if console {
            "java.exe"
        } else {
            "javaw.exe"
        }
    } else {
        "java"
    }
}

/// Executável Java dentro de um diretório de instalação (`<home>/bin/java*`).
/// No Windows prioriza `javaw.exe` para jogar e `java.exe` para console.
fn executavel_java_da_instalacao(
    java_home: &std::path::Path,
    preferir_console: bool,
) -> Option<std::path::PathBuf> {
    let bin = java_home.join("bin");
    let candidatos: Vec<&str> = if cfg!(windows) {
        if preferir_console {
            vec!["java.exe", "javaw.exe"]
        } else {
            vec!["javaw.exe", "java.exe"]
        }
    } else {
        vec!["java"]
    };
    candidatos
        .iter()
        .map(|nome| bin.join(nome))
        .find(|caminho| caminho.exists())
}

/// Detecta todas as instalações de Java no sistema (estilo HeliosLauncher)
#[tauri::command]
pub async fn detect_java_installations() -> Result<Vec<JavaInfo>, String> {
    let mut javas: Vec<JavaInfo> = Vec::new();
    let mut checked_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. Verificar runtime gerenciado pelo launcher
    let runtime_dir = get_runtime_dir();
    if runtime_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&runtime_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Some(exe) = executavel_java_da_instalacao(&entry.path(), false) {
                        let path_str = entry.path().to_string_lossy().to_string();
                        if checked_paths.insert(path_str.clone()) {
                            if let Some(info) = probe_java(&exe, true).await {
                                javas.push(info);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Verificar JAVA_HOME e outras variáveis de ambiente
    for env_key in &["JAVA_HOME", "JRE_HOME", "JDK_HOME"] {
        if let Ok(val) = std::env::var(env_key) {
            let java_home = std::path::PathBuf::from(&val);
            if let Some(java_exe) = executavel_java_da_instalacao(&java_home, false) {
                if java_exe.exists() && checked_paths.insert(val.clone()) {
                    if let Some(info) = probe_java(&java_exe, false).await {
                        javas.push(info);
                    }
                }
            }
        }
    }

    // 3. Verificar pastas comuns de instalação por sistema
    #[cfg(target_os = "windows")]
    {
        let drive_letters = vec!["C", "D", "E"];
        let search_dirs = vec![
            "Program Files\\Java",
            "Program Files\\Eclipse Adoptium",
            "Program Files\\Eclipse Foundation",
            "Program Files\\AdoptOpenJDK",
            "Program Files\\Amazon Corretto",
            "Program Files\\Microsoft",
            "Program Files\\Zulu",
        ];

        for drive in &drive_letters {
            for dir in &search_dirs {
                let base = std::path::PathBuf::from(format!("{}:\\{}", drive, dir));
                if base.exists() {
                    if let Ok(entries) = std::fs::read_dir(&base) {
                        for entry in entries.flatten() {
                            if entry.path().is_dir() {
                                if let Some(java_exe) =
                                    executavel_java_da_instalacao(&entry.path(), false)
                                {
                                    let path_str = entry.path().to_string_lossy().to_string();
                                    if java_exe.exists() && checked_paths.insert(path_str.clone()) {
                                        if let Some(info) = probe_java(&java_exe, false).await {
                                            javas.push(info);
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

    // 3.1 No Linux, verificar diretórios comuns de JDK
    #[cfg(target_os = "linux")]
    {
        let search_dirs = vec!["/usr/lib/jvm", "/opt"];

        for dir in &search_dirs {
            let base = std::path::PathBuf::from(dir);
            if base.exists() {
                if let Ok(entries) = std::fs::read_dir(&base) {
                    for entry in entries.flatten() {
                        let nome_pasta = entry.file_name().to_string_lossy().to_lowercase();
                        let candidata = nome_pasta.contains("jdk") || nome_pasta.contains("java");
                        if entry.path().is_dir() && candidata {
                            if let Some(java_exe) =
                                executavel_java_da_instalacao(&entry.path(), false)
                            {
                                let path_str = entry.path().to_string_lossy().to_string();
                                if java_exe.exists() && checked_paths.insert(path_str.clone()) {
                                    if let Some(info) = probe_java(&java_exe, false).await {
                                        javas.push(info);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 4. Verificar se Java está acessível no PATH
    if let Some(java_exe_path) = resolver_caminho_java_do_path() {
        let path_str = java_exe_path.to_string_lossy().to_string();
        if checked_paths.insert(path_str) {
            if let Some(info) = probe_java(&java_exe_path, false).await {
                if !javas
                    .iter()
                    .any(|j| j.version == info.version && j.vendor == info.vendor)
                {
                    javas.push(info);
                }
            }
        }
    }

    // Ordenar: managed primeiro, depois por versão major (maior primeiro)
    javas.sort_by(|a, b| b.is_managed.cmp(&a.is_managed).then(b.major.cmp(&a.major)));

    Ok(javas)
}

/// Obter a versão do Java necessária para uma versão do Minecraft
fn get_required_java_major(mc_version: &str) -> u32 {
    let parts: Vec<u32> = mc_version
        .split('.')
        .filter_map(|p| p.parse().ok())
        .collect();

    let (major, minor) = match parts.as_slice() {
        [m, n, ..] => (*m, *n),
        [m] => (*m, 0),
        _ => (1, 0),
    };

    if major >= 26 {
        return 25;
    }

    if major == 1 {
        if minor >= 21 {
            return 21;
        }
        if minor >= 18 {
            return 17;
        }
        if minor >= 17 {
            return 16;
        }
        return 8;
    }

    8
}

/// Probar un ejecutable de Java para obtener info de versión
pub async fn probe_java(exe_path: &std::path::Path, is_managed: bool) -> Option<JavaInfo> {
    let mut comando_probe = tokio::process::Command::new(exe_path);
    comando_probe.arg("-version");
    #[cfg(target_os = "windows")]
    comando_probe.creation_flags(CREATE_NO_WINDOW);
    let output = comando_probe.output().await.ok()?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let base_path = exe_path
        .parent()
        .map(|p| {
            if p.file_name()
                .map(|n| n.to_string_lossy().eq_ignore_ascii_case("bin"))
                .unwrap_or(false)
            {
                p.parent().unwrap_or(p)
            } else {
                p
            }
        })
        .unwrap_or(exe_path);

    parse_java_version_output(&stderr, &base_path.to_string_lossy(), is_managed)
}

/// Parsear a saída de `java -version`
fn parse_java_version_output(output: &str, path: &str, is_managed: bool) -> Option<JavaInfo> {
    // Linha 1: java/openjdk version "VERSION"
    let first_line = output.lines().next()?;

    // Extrair versão entre aspas
    let version_str = first_line.split('"').nth(1)?;

    // Parsear major version
    let major = if version_str.starts_with("1.") {
        // Java 8: "1.8.0_xxx"
        version_str.split('.').nth(1)?.parse::<u32>().ok()?
    } else {
        // Java 9+: "17.0.5", "21.0.1"
        version_str.split('.').next()?.parse::<u32>().ok()?
    };

    // Detectar vendor
    let vendor = if output.contains("Eclipse Adoptium") || output.contains("Temurin") {
        "Eclipse Adoptium".to_string()
    } else if output.contains("Corretto") {
        "Amazon Corretto".to_string()
    } else if output.contains("Zulu") {
        "Azul Zulu".to_string()
    } else if output.contains("GraalVM") {
        "GraalVM".to_string()
    } else if output.contains("Oracle") {
        "Oracle".to_string()
    } else if output.contains("Microsoft") {
        "Microsoft".to_string()
    } else {
        "OpenJDK".to_string()
    };

    // Detectar arquitetura
    let arch = if output.contains("64-Bit") || output.contains("amd64") || output.contains("x86_64")
    {
        "x64".to_string()
    } else if output.contains("aarch64") {
        "arm64".to_string()
    } else {
        "x86".to_string()
    };

    Some(JavaInfo {
        path: path.to_string(),
        version: version_str.to_string(),
        major,
        vendor,
        arch,
        is_managed,
    })
}

/// Baixar e instalar Java automaticamente do Adoptium
#[tauri::command]
pub async fn install_java(major: u32) -> Result<JavaInfo, String> {
    let client = reqwest::Client::new();
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    };
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "mac",
        _ => "linux",
    };

    println!(
        "[Java] Buscando JDK {} do Adoptium ({} {})...",
        major, os, arch
    );

    // Buscar binário mais recente
    let api_url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?vendor=eclipse",
        major
    );

    let res: Vec<serde_json::Value> = client
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar JDK: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta: {}", e))?;

    // Encontrar o binário correto (JDK, Windows, x64)
    let target = res
        .iter()
        .find(|entry| {
            let binary = &entry["binary"];
            binary["os"].as_str() == Some(os)
                && binary["architecture"].as_str() == Some(arch)
                && binary["image_type"].as_str() == Some("jdk")
        })
        .ok_or_else(|| format!("JDK {} não encontrado para {} {}", major, os, arch))?;

    let download_url = target["binary"]["package"]["link"]
        .as_str()
        .ok_or("URL de download não encontrada")?;
    let file_name = target["binary"]["package"]["name"]
        .as_str()
        .ok_or("Nome do arquivo não encontrado")?;
    let file_size = target["binary"]["package"]["size"].as_u64().unwrap_or(0);

    println!(
        "[Java] Baixando {} ({} MB)...",
        file_name,
        file_size / 1024 / 1024
    );

    // Baixar o arquivo
    let runtime_dir = get_runtime_dir();
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("Erro ao criar diretório runtime: {}", e))?;

    let archive_path = runtime_dir.join(file_name);

    let response = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Erro ao baixar: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Erro ao ler bytes: {}", e))?;

    std::fs::write(&archive_path, &bytes).map_err(|e| format!("Erro ao salvar arquivo: {}", e))?;

    println!("[Java] Extraindo {}...", file_name);

    let extract_dir = runtime_dir.clone();

    // No Windows o Adoptium distribui um ZIP; no Linux/macOS um .tar.gz.
    let java_home = if file_name.to_lowercase().ends_with(".zip") {
        let file = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Erro ao abrir arquivo: {}", e))?;

        let mut zip_archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Erro ao abrir ZIP: {}", e))?;

        // Encontrar o nome da pasta raiz dentro do ZIP
        let root_folder = {
            let first = zip_archive
                .by_index(0)
                .map_err(|e| format!("ZIP vazio: {}", e))?;
            let name = first.name().to_string();
            name.split('/').next().unwrap_or("").to_string()
        };

        // Extrair
        for i in 0..zip_archive.len() {
            let mut entry = zip_archive
                .by_index(i)
                .map_err(|e| format!("Erro no ZIP: {}", e))?;
            let outpath = extract_dir.join(entry.name());

            if entry.is_dir() {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(parent) = outpath.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Erro ao criar arquivo: {}", e))?;
                std::io::copy(&mut entry, &mut outfile)
                    .map_err(|e| format!("Erro ao extrair: {}", e))?;
            }
        }

        extract_dir.join(&root_folder)
    } else {
        // Encontrar o nome da pasta raiz dentro do .tar.gz lendo a primeira entrada
        let root_folder = {
            let arquivo = std::fs::File::open(&archive_path)
                .map_err(|e| format!("Erro ao abrir arquivo: {}", e))?;
            let decodificado = flate2::read::GzDecoder::new(arquivo);
            let mut arquivo_tar = tar::Archive::new(decodificado);
            let mut entradas = arquivo_tar
                .entries()
                .map_err(|e| format!("Erro ao ler TAR: {}", e))?;
            let primeira = entradas
                .next()
                .ok_or("TAR vazio: nenhuma entrada encontrada.")?
                .map_err(|e| format!("Erro no TAR: {}", e))?;
            let nome = primeira
                .path()
                .map_err(|e| format!("Erro ao ler nome no TAR: {}", e))?
                .to_string_lossy()
                .to_string();
            nome.split('/').next().unwrap_or("").to_string()
        };

        // Extrair com o leitor na posicao inicial (pos = 0)
        let arquivo = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Erro ao abrir arquivo: {}", e))?;
        let decodificado = flate2::read::GzDecoder::new(arquivo);
        let mut arquivo_tar = tar::Archive::new(decodificado);
        arquivo_tar
            .unpack(&extract_dir)
            .map_err(|e| format!("Erro ao extrair TAR: {}", e))?;

        extract_dir.join(&root_folder)
    };

    // Limpar arquivo de instalação
    std::fs::remove_file(&archive_path).ok();

    // Verificar a instalação
    let java_exe = executavel_java_da_instalacao(&java_home, true).ok_or_else(|| {
        format!(
            "Java não encontrado após extração em {:?}",
            java_home.join("bin")
        )
    })?;

    if !java_exe.exists() {
        return Err(format!(
            "Java não encontrado após extração em {:?}",
            java_exe
        ));
    }

    println!(
        "[Java] JDK {} instalado com sucesso em {:?}",
        major, java_home
    );

    // Probar a instalação
    let info = probe_java(&java_exe, true)
        .await
        .ok_or("Falha ao verificar Java instalado")?;

    Ok(info)
}

async fn garantir_java_compativel(mc_version: &str, required_major: u32) -> Result<String, String> {
    println!("[Java] MC {} requer Java {}", mc_version, required_major);

    // 1. Verificar configurações - se o usuário definiu um caminho manual
    let settings = get_settings().await.unwrap_or_default();
    if !settings.auto_java {
        if let Some(ref path) = settings.java_path {
            if !path.is_empty() {
                let dir = std::path::PathBuf::from(path);
                if let Some(java_exe) = executavel_java_da_instalacao(&dir, false) {
                    if java_exe.exists() {
                        return Ok(java_exe.to_string_lossy().to_string());
                    }
                }
                if dir.is_file() {
                    return Ok(dir.to_string_lossy().to_string());
                }
            }
        }
        // Se desabilitou auto e não tem caminho, tentar achar no PATH
        if let Some(path_exe) = resolver_caminho_java_do_path() {
            return Ok(path_exe.to_string_lossy().to_string());
        }
        return Ok("java".to_string());
    }

    // 2. Buscar nas instalações detectadas
    let installations = detect_java_installations().await?;

    let arquitetura_necessaria = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };

    // Runtimes mais novos nem sempre são compatíveis com versões antigas do jogo.
    let best = installations
        .iter()
        .filter(|java| java.major == required_major && java.arch == arquitetura_necessaria)
        .min_by_key(|java| if java.is_managed { 0 } else { 1 });

    if let Some(java) = best {
        println!(
            "[Java] Encontrado Java {} ({}) em {}",
            java.version, java.vendor, java.path
        );
        let dir = std::path::PathBuf::from(&java.path);
        if let Some(java_exe) = executavel_java_da_instalacao(&dir, false) {
            if java_exe.exists() {
                return Ok(java_exe.to_string_lossy().to_string());
            }
        }
        if dir.is_file() {
            return Ok(dir.to_string_lossy().to_string());
        }
    }

    // 3. Se auto_java, baixar automaticamente
    println!(
        "[Java] Nenhum Java {} encontrado, baixando automaticamente...",
        required_major
    );
    let installed = install_java(required_major).await?;
    let dir = std::path::PathBuf::from(&installed.path);
    if let Some(java_exe) = executavel_java_da_instalacao(&dir, false) {
        if java_exe.exists() {
            return Ok(java_exe.to_string_lossy().to_string());
        }
    }
    Ok(installed.path)
}

/// Dado um caminho de Java (que pode ser javaw.exe), retorna o executável java.exe
/// correspondente para comandos de linha de comando (instaladores Forge/NeoForge).
pub fn resolver_executavel_java_console(java_caminho: &str) -> String {
    let path = std::path::Path::new(java_caminho);
    if let Some(nome) = path.file_name().and_then(|n| n.to_str()) {
        if nome.eq_ignore_ascii_case("javaw.exe") {
            let alt = path.with_file_name("java.exe");
            if alt.exists() {
                return alt.to_string_lossy().to_string();
            }
        } else if nome.eq_ignore_ascii_case("javaw") {
            let alt = path.with_file_name("java");
            if alt.exists() {
                return alt.to_string_lossy().to_string();
            }
        }
    }
    if java_caminho == "java" {
        if let Some(path_exe) = resolver_caminho_java_do_path() {
            return path_exe.to_string_lossy().to_string();
        }
    }
    java_caminho.to_string()
}

/// Garante um executável Java de linha de comando (java.exe) compatível com a versão do Minecraft.
/// Útil para rodar instaladores CLI (Forge, NeoForge).
pub async fn ensure_java_cli_for_version(mc_version: &str) -> Result<String, String> {
    let java_bruta = ensure_java_for_version(mc_version.to_string()).await?;
    let java_cli = resolver_executavel_java_console(&java_bruta);

    // Validar se o executável do Java responde
    let mut comando_teste = std::process::Command::new(&java_cli);
    comando_teste.arg("-version");
    #[cfg(target_os = "windows")]
    comando_teste.creation_flags(CREATE_NO_WINDOW);

    match comando_teste.output() {
        Ok(_) => Ok(java_cli),
        Err(e) => Err(format!(
            "Java não pôde ser executado ('{}') para Minecraft {}: {}",
            java_cli, mc_version, e
        )),
    }
}

/// Garantir que exista um Java adequado para a versão do MC.
#[tauri::command]
pub async fn ensure_java_for_version(mc_version: String) -> Result<String, String> {
    let required_major = get_required_java_major(&mc_version);
    garantir_java_compativel(&mc_version, required_major).await
}

pub async fn ensure_java_for_manifest(
    mc_version: String,
    manifest_java_major: Option<u32>,
) -> Result<String, String> {
    let required_major =
        manifest_java_major.unwrap_or_else(|| get_required_java_major(&mc_version));
    garantir_java_compativel(&mc_version, required_major).await
}

/// Obter versão Java necessária para uma versão MC (frontend)
#[tauri::command]
pub async fn get_required_java(mc_version: String) -> Result<u32, String> {
    Ok(get_required_java_major(&mc_version))
}

#[cfg(test)]
mod tests {
    use super::{get_required_java_major, resolver_executavel_java_console, validar_cor_destaque};

    #[test]
    fn valida_cor_de_destaque_hexadecimal() {
        assert!(validar_cor_destaque("#10B981").is_ok());
        assert!(validar_cor_destaque("#f97316").is_ok());
        assert!(validar_cor_destaque("laranja").is_err());
        assert!(validar_cor_destaque("#FFF").is_err());
        assert!(validar_cor_destaque("#GG0000").is_err());
    }

    #[test]
    fn identifica_java_das_versoes_classicas() {
        assert_eq!(get_required_java_major("1.16.5"), 8);
        assert_eq!(get_required_java_major("1.17.1"), 16);
        assert_eq!(get_required_java_major("1.20.1"), 17);
        assert_eq!(get_required_java_major("1.21.11"), 21);
    }

    #[test]
    fn identifica_java_do_versionamento_por_ano() {
        assert_eq!(get_required_java_major("26.1.2"), 25);
        assert_eq!(get_required_java_major("26.1-snapshot"), 25);
        assert_eq!(get_required_java_major("27.1.0"), 25);
    }

    #[test]
    fn preserva_ou_converte_java_console() {
        let resultado = resolver_executavel_java_console("java");
        assert!(!resultado.is_empty());
    }

    #[test]
    fn testa_extracao_tar_gz_com_posicao_limpa() {
        use flate2::write::GzEncoder;
        use flate2::Compression;

        let temp_dir = std::env::temp_dir().join(format!(
            "teste_tar_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let archive_path = temp_dir.join("test.tar.gz");

        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let enc = GzEncoder::new(file, Compression::default());
            let mut builder = tar::Builder::new(enc);

            let dados = b"teste java binario";
            let mut header = tar::Header::new_gnu();
            header.set_path("jdk-21/bin/java").unwrap();
            header.set_size(dados.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append(&header, &dados[..]).unwrap();
            builder.finish().unwrap();
        }

        let extract_dir = temp_dir.join("extract");
        std::fs::create_dir_all(&extract_dir).unwrap();

        let root_folder = {
            let arquivo = std::fs::File::open(&archive_path).unwrap();
            let decodificado = flate2::read::GzDecoder::new(arquivo);
            let mut arquivo_tar = tar::Archive::new(decodificado);
            let mut entradas = arquivo_tar.entries().unwrap();
            let primeira = entradas.next().unwrap().unwrap();
            let nome = primeira.path().unwrap().to_string_lossy().to_string();
            nome.split('/').next().unwrap_or("").to_string()
        };

        let arquivo = std::fs::File::open(&archive_path).unwrap();
        let decodificado = flate2::read::GzDecoder::new(arquivo);
        let mut arquivo_tar = tar::Archive::new(decodificado);
        arquivo_tar.unpack(&extract_dir).unwrap();

        assert_eq!(root_folder, "jdk-21");
        assert!(extract_dir.join("jdk-21").join("bin").join("java").exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
