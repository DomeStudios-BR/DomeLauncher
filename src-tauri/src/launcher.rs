use base64::engine::general_purpose::STANDARD as BASE64_PADRAO;
use base64::Engine;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static BLOQUEIO_ARQUIVOS_INSTANCIA: Mutex<()> = Mutex::new(());

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    pub r#type: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Artifact {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<serde_json::Value>, // Simplificado para Value por enquanto
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<Rule>>,
    pub natives: Option<serde_json::Value>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Rule {
    pub action: String,
    pub os: Option<OsRule>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OsRule {
    pub name: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionDetail {
    pub id: String,
    pub r#type: String,
    pub downloads: Downloads,
    pub main_class: String,
    pub libraries: Vec<Library>,
    pub assets: String,
    pub asset_index: AssetIndex,
    pub compliance_level: Option<u32>,
    pub java_version: Option<JavaVersion>,
    pub arguments: Option<serde_json::Value>,
    pub minecraft_arguments: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersion {
    pub component: String,
    pub major_version: u32,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
    pub total_size: Option<u64>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Downloads {
    pub client: DownloadEntry,
    pub server: Option<DownloadEntry>,
    pub windows_server: Option<DownloadEntry>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(alias = "mc_type")]
    pub mc_type: String,
    #[serde(alias = "loader_type")]
    pub loader_type: Option<String>,
    #[serde(alias = "loader_version")]
    pub loader_version: Option<String>,
    pub icon: Option<String>,
    pub path: PathBuf,
    pub created: String,
    #[serde(alias = "last_played")]
    pub last_played: Option<String>,
    #[serde(default, alias = "total_playtime_seconds")]
    pub tempo_total_jogado_segundos: u64,
    #[serde(
        default,
        alias = "session_started_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub sessao_iniciada_em: Option<String>,
    #[serde(alias = "java_args")]
    pub java_args: Option<String>,
    #[serde(alias = "mc_args")]
    pub mc_args: Option<String>,
    pub memory: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum LoaderType {
    Fabric,
    Forge,
    NeoForge,
    Quilt,
    Vanilla,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModPlatform {
    CurseForge,
    Modrinth,
    #[serde(rename = "ftb")]
    Ftb,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub platform: ModPlatform,
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub version_id: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModPack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub minecraft_version: String,
    pub loader_type: LoaderType,
    pub loader_version: String,
    pub download_url: String,
    pub file_name: String,
    pub icon: Option<String>,
    pub image: Option<String>,
    pub screenshots: Vec<String>,
    pub mods: Vec<ModInfo>,
    pub resource_packs: Vec<String>,
    pub shader_packs: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ResourcePack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub icon: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShaderPack {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub download_url: String,
    pub file_name: String,
    pub icon: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MinecraftAccount {
    pub id: String,
    pub uuid: String,
    pub name: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
    pub token_type: String,
}

const PREFIXO_ARQUIVO_PROTEGIDO: &str = "DOME-DPAPI-v1:";

#[cfg(target_os = "windows")]
pub(crate) fn proteger_bytes_sistema(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let entrada = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut saida = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let sucesso = unsafe {
        CryptProtectData(
            &entrada,
            null(),
            null_mut(),
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut saida,
        )
    };

    if sucesso == 0 {
        return Err(format!(
            "Erro ao proteger dados da conta: {}",
            std::io::Error::last_os_error()
        ));
    }

    let protegidos = unsafe {
        let slice = std::slice::from_raw_parts(saida.pbData, saida.cbData as usize).to_vec();
        LocalFree(saida.pbData as _);
        slice
    };

    Ok(protegidos)
}

#[cfg(target_os = "windows")]
pub(crate) fn desproteger_bytes_sistema(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    let entrada = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut saida = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let sucesso = unsafe {
        CryptUnprotectData(
            &entrada,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut saida,
        )
    };

    if sucesso == 0 {
        return Err(format!(
            "Erro ao ler dados protegidos da conta: {}",
            std::io::Error::last_os_error()
        ));
    }

    let abertos = unsafe {
        let slice = std::slice::from_raw_parts(saida.pbData, saida.cbData as usize).to_vec();
        LocalFree(saida.pbData as _);
        slice
    };

    Ok(abertos)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn proteger_bytes_sistema(bytes: &[u8]) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn desproteger_bytes_sistema(bytes: &[u8]) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}

fn ler_json_seguro<T: DeserializeOwned>(caminho: &std::path::Path) -> Result<(T, bool), String> {
    let conteudo = std::fs::read_to_string(caminho)
        .map_err(|e| format!("Erro ao ler arquivo protegido: {}", e))?;

    if let Some(codificado) = conteudo.trim().strip_prefix(PREFIXO_ARQUIVO_PROTEGIDO) {
        let bytes_protegidos = BASE64_PADRAO
            .decode(codificado)
            .map_err(|e| format!("Erro ao decodificar arquivo protegido: {}", e))?;
        let bytes_json = desproteger_bytes_sistema(&bytes_protegidos)?;
        let valor = serde_json::from_slice::<T>(&bytes_json)
            .map_err(|e| format!("Erro ao parsear arquivo protegido: {}", e))?;
        return Ok((valor, true));
    }

    let valor = serde_json::from_str::<T>(&conteudo)
        .map_err(|e| format!("Erro ao parsear arquivo legado: {}", e))?;
    Ok((valor, false))
}

fn escrever_json_seguro<T: Serialize>(caminho: &std::path::Path, valor: &T) -> Result<(), String> {
    if let Some(parent) = caminho.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }

    let bytes_json = serde_json::to_vec_pretty(valor)
        .map_err(|e| format!("Erro ao serializar dados protegidos: {}", e))?;
    let bytes_protegidos = proteger_bytes_sistema(&bytes_json)?;
    let conteudo = format!(
        "{}{}",
        PREFIXO_ARQUIVO_PROTEGIDO,
        BASE64_PADRAO.encode(bytes_protegidos)
    );

    std::fs::write(caminho, conteudo).map_err(|e| format!("Erro ao salvar arquivo: {}", e))
}

/// Pasta raiz de dados do launcher ao nível do usuário.
/// No Windows preserva `%APPDATA%\dome`; em outros sistemas usa o diretório de
/// dados do usuário (ex.: `~/.local/share/dome` no Linux via XDG).
pub(crate) fn pasta_dados_launcher() -> PathBuf {
    directories::BaseDirs::new()
        .map(|base| base.data_dir().join("dome"))
        .unwrap_or_else(|| PathBuf::from("dome"))
}

pub(crate) fn pasta_backups_instancias() -> PathBuf {
    pasta_dados_launcher().join("backups").join("instances")
}

pub(crate) fn pasta_cache_social() -> PathBuf {
    pasta_dados_launcher().join("cache").join("social")
}

pub(crate) fn pasta_preparacao_social() -> PathBuf {
    pasta_dados_launcher()
        .join("temp")
        .join("social")
        .join("preparation")
}

pub(crate) fn pasta_recibos_sociais() -> PathBuf {
    pasta_dados_launcher().join("social").join("receipts")
}

fn mesclar_pasta_legada(origem: &Path, destino: &Path) -> Result<(), String> {
    if !origem.exists() {
        return Ok(());
    }
    if !destino.exists() {
        if let Some(pai) = destino.parent() {
            std::fs::create_dir_all(pai).map_err(|e| e.to_string())?;
        }
        if std::fs::rename(origem, destino).is_ok() {
            return Ok(());
        }
        std::fs::create_dir_all(destino).map_err(|e| e.to_string())?;
    }

    for entrada in std::fs::read_dir(origem).map_err(|e| e.to_string())? {
        let entrada = entrada.map_err(|e| e.to_string())?;
        let caminho_origem = entrada.path();
        let caminho_destino = destino.join(entrada.file_name());
        if !caminho_destino.exists() {
            mover_entrada_legada(&caminho_origem, &caminho_destino)?;
            continue;
        }
        if caminho_origem.is_dir() && caminho_destino.is_dir() {
            mesclar_pasta_legada(&caminho_origem, &caminho_destino)?;
            continue;
        }
        let nome = entrada.file_name().to_string_lossy().to_string();
        let alternativo = destino.join(format!("legacy-{}-{nome}", uuid::Uuid::new_v4()));
        mover_entrada_legada(&caminho_origem, &alternativo)?;
    }
    std::fs::remove_dir(origem).map_err(|e| e.to_string())
}

fn mover_entrada_legada(origem: &Path, destino: &Path) -> Result<(), String> {
    if std::fs::rename(origem, destino).is_ok() {
        return Ok(());
    }
    if origem.is_dir() {
        std::fs::create_dir_all(destino).map_err(|e| e.to_string())?;
        mesclar_pasta_legada(origem, destino)
    } else {
        std::fs::copy(origem, destino).map_err(|e| e.to_string())?;
        std::fs::remove_file(origem).map_err(|e| e.to_string())
    }
}

fn migrar_pastas_auxiliares_instancias(raiz_instancias: &Path) -> Result<(), String> {
    for (nome_legado, destino) in [
        (".dome-backups", pasta_backups_instancias()),
        (".social-cache", pasta_cache_social()),
        (".social-preparacao", pasta_preparacao_social()),
        (".social-recebimentos", pasta_recibos_sociais()),
    ] {
        mesclar_pasta_legada(&raiz_instancias.join(nome_legado), &destino)?;
    }
    Ok(())
}

fn caminho_sessao_social() -> PathBuf {
    pasta_dados_launcher().join("social-session.dat")
}

/// Nome do sistema atual conforme o manifesto do Minecraft
/// (`windows`, `linux` ou `osx`).
pub(crate) fn nome_sistema_minecraft() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "osx",
        _ => "linux",
    }
}

/// Chave `natives-*` do manifesto correspondente ao sistema atual.
pub(crate) fn nome_classifier_nativos() -> &'static str {
    match std::env::consts::OS {
        "windows" => "natives-windows",
        "macos" => "natives-osx",
        _ => "natives-linux",
    }
}

/// Extensão dos binários nativos extraídos (`.dll`, `.so` ou `.dylib`).
pub(crate) fn extensao_nativos() -> &'static str {
    match std::env::consts::OS {
        "windows" => "dll",
        "macos" => "dylib",
        _ => "so",
    }
}

/// Separador de entradas do classpath (ponto e vírgula no Windows, dois pontos nos demais).
pub(crate) fn separador_classpath() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

#[tauri::command]
pub fn carregar_sessao_social_local() -> Result<Option<String>, String> {
    let caminho = caminho_sessao_social();
    if !caminho.exists() {
        return Ok(None);
    }

    ler_json_seguro::<String>(&caminho).map(|(sessao, _)| Some(sessao))
}

#[tauri::command]
pub fn salvar_sessao_social_local(sessao: Option<String>) -> Result<(), String> {
    let caminho = caminho_sessao_social();
    if let Some(sessao) = sessao.filter(|valor| !valor.trim().is_empty()) {
        return escrever_json_seguro(&caminho, &sessao);
    }

    if caminho.exists() {
        std::fs::remove_file(caminho)
            .map_err(|e| format!("Erro ao remover sessão social local: {}", e))?;
    }
    Ok(())
}

#[derive(Debug)]
pub struct LauncherState {
    pub account: Arc<Mutex<Option<MinecraftAccount>>>,
    pub accounts: Arc<Mutex<Vec<MinecraftAccount>>>,
    pub(crate) instances_path: Arc<Mutex<PathBuf>>,
    pub processos_instancias: Arc<Mutex<HashMap<String, u32>>>,
}

impl LauncherState {
    fn listar_processos_java() -> Vec<(u32, String)> {
        use sysinfo::{ProcessRefreshKind, RefreshKind, System, UpdateKind};

        let mut sistema = System::new_with_specifics(
            RefreshKind::new()
                .with_processes(ProcessRefreshKind::new().with_cmd(UpdateKind::Always)),
        );
        sistema.refresh_processes();

        sistema
            .processes()
            .values()
            .filter_map(|processo| {
                let nome = processo.name().to_lowercase();
                if !nome.contains("java") {
                    return None;
                }

                let cmdline = processo
                    .cmd()
                    .iter()
                    .map(|arg| arg.to_string())
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase()
                    .replace('\\', "/");

                Some((processo.pid().as_u32(), cmdline))
            })
            .collect()
    }

    fn processo_pid_esta_em_execucao(processos_java: &[(u32, String)], pid: u32) -> bool {
        processos_java.iter().any(|(pid_java, _)| *pid_java == pid)
    }

    fn atualizar_tempo_jogado_instancia_por_caminho(
        instances_path: &std::path::Path,
        instance_id: &str,
        forcar_atualizacao: bool,
        encerrar_sessao: bool,
    ) -> Result<(), String> {
        let _bloqueio = BLOQUEIO_ARQUIVOS_INSTANCIA
            .lock()
            .map_err(|_| "Falha ao bloquear atualização da instância".to_string())?;
        let caminho_config = instances_path.join(instance_id).join("instance.json");
        if !caminho_config.exists() {
            return Ok(());
        }

        let conteudo = std::fs::read_to_string(&caminho_config).map_err(|e| {
            format!(
                "Erro ao ler instance.json para atualizar tempo jogado ({}): {}",
                instance_id, e
            )
        })?;
        let (mut instancia, recuperada) =
            Self::ler_instancia_do_conteudo(&conteudo).map_err(|e| {
                format!(
                    "Erro ao parsear instance.json para atualizar tempo jogado ({}): {}",
                    instance_id, e
                )
            })?;

        if recuperada {
            Self::salvar_instancia_em_arquivo(&caminho_config, &instancia);
        }

        let Some(sessao_iniciada_em) = instancia.sessao_iniciada_em.clone() else {
            return Ok(());
        };

        let agora = chrono::Utc::now();
        let acrescimo = Self::calcular_duracao_sessao_segundos(sessao_iniciada_em.as_str(), &agora);
        let deve_atualizar = acrescimo >= 60 || (forcar_atualizacao && acrescimo > 0);

        if deve_atualizar {
            instancia.tempo_total_jogado_segundos = instancia
                .tempo_total_jogado_segundos
                .saturating_add(acrescimo);

            if encerrar_sessao {
                instancia.sessao_iniciada_em = None;
            } else {
                instancia.sessao_iniciada_em = Some(agora.to_rfc3339());
            }
            Self::salvar_instancia_em_arquivo(&caminho_config, &instancia);
            return Ok(());
        }

        if encerrar_sessao {
            instancia.sessao_iniciada_em = None;
            Self::salvar_instancia_em_arquivo(&caminho_config, &instancia);
        }

        Ok(())
    }

    pub fn iniciar_monitoramento_tempo_jogado(&self, instance_id: &str, pid: u32) {
        let instance_id = instance_id.to_string();
        let Ok(instances_path) = self.caminho_instancias() else {
            eprintln!("[Instâncias] Falha ao acessar a pasta durante o monitoramento.");
            return;
        };
        let processos_instancias = Arc::clone(&self.processos_instancias);

        tauri::async_runtime::spawn(async move {
            let mut ultimo_tick = chrono::Utc::now();

            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

                let pid_ainda_registrado = processos_instancias
                    .lock()
                    .ok()
                    .and_then(|processos| processos.get(&instance_id).copied())
                    .map(|pid_registrado| pid_registrado == pid)
                    .unwrap_or(false);

                if !pid_ainda_registrado {
                    break;
                }

                let processos_java = Self::listar_processos_java();
                if !Self::processo_pid_esta_em_execucao(&processos_java, pid) {
                    let _ = Self::atualizar_tempo_jogado_instancia_por_caminho(
                        &instances_path,
                        &instance_id,
                        true,
                        true,
                    );
                    if let Ok(mut processos) = processos_instancias.lock() {
                        processos.remove(&instance_id);
                    }
                    break;
                }

                if chrono::Utc::now()
                    .signed_duration_since(ultimo_tick)
                    .num_seconds()
                    >= 60
                {
                    let _ = Self::atualizar_tempo_jogado_instancia_por_caminho(
                        &instances_path,
                        &instance_id,
                        false,
                        false,
                    );
                    ultimo_tick = chrono::Utc::now();
                }
            }
        });
    }

    pub fn iniciar_monitoramento_processo(
        &self,
        instance_id: &str,
        mut processo: std::process::Child,
    ) {
        let instance_id = instance_id.to_string();
        let pid = processo.id();

        let Ok(instances_path) = self.caminho_instancias() else {
            eprintln!("[Instâncias] Falha ao acessar a pasta durante o monitoramento.");
            return;
        };
        self.registrar_processo_instancia(&instance_id, pid);
        let processos_instancias = Arc::clone(&self.processos_instancias);

        tauri::async_runtime::spawn_blocking(move || {
            let mut ultimo_tick = chrono::Utc::now();

            loop {
                match processo.try_wait() {
                    Ok(Some(_)) | Err(_) => {
                        let _ = Self::atualizar_tempo_jogado_instancia_por_caminho(
                            &instances_path,
                            &instance_id,
                            true,
                            true,
                        );
                        if let Ok(mut processos) = processos_instancias.lock() {
                            if processos.get(&instance_id).copied() == Some(pid) {
                                processos.remove(&instance_id);
                            }
                        }
                        break;
                    }
                    Ok(None) => {}
                }

                if chrono::Utc::now()
                    .signed_duration_since(ultimo_tick)
                    .num_seconds()
                    >= 60
                {
                    let _ = Self::atualizar_tempo_jogado_instancia_por_caminho(
                        &instances_path,
                        &instance_id,
                        false,
                        false,
                    );
                    ultimo_tick = chrono::Utc::now();
                }

                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        });
    }

    fn calcular_duracao_sessao_segundos(
        sessao_iniciada_em: &str,
        agora: &chrono::DateTime<chrono::Utc>,
    ) -> u64 {
        let inicio = match chrono::DateTime::parse_from_rfc3339(sessao_iniciada_em) {
            Ok(data) => data.with_timezone(&chrono::Utc),
            Err(_) => return 0,
        };

        if *agora <= inicio {
            return 0;
        }

        agora.signed_duration_since(inicio).num_seconds().max(0) as u64
    }

    fn salvar_instancia_em_arquivo(caminho_config: &std::path::Path, instancia: &Instance) {
        if let Ok(conteudo) = serde_json::to_string_pretty(instancia) {
            if let Err(erro) = std::fs::write(caminho_config, conteudo) {
                eprintln!(
                    "[Instâncias] Aviso: falha ao salvar atualização de tempo em {:?}: {}",
                    caminho_config, erro
                );
            }
        }
    }

    fn ler_instancia_do_conteudo(conteudo: &str) -> Result<(Instance, bool), serde_json::Error> {
        match serde_json::from_str::<Instance>(conteudo) {
            Ok(instancia) => Ok((instancia, false)),
            Err(erro_original) => {
                let mut valores =
                    serde_json::Deserializer::from_str(conteudo).into_iter::<Instance>();
                match valores.next() {
                    Some(Ok(instancia)) if valores.byte_offset() < conteudo.len() => {
                        Ok((instancia, true))
                    }
                    _ => Err(erro_original),
                }
            }
        }
    }

    pub fn finalizar_tempo_jogado_instancia(&self, instance_id: &str) -> Result<(), String> {
        let instances_path = self.caminho_instancias()?;
        Self::atualizar_tempo_jogado_instancia_por_caminho(&instances_path, instance_id, true, true)
    }

    pub fn caminho_instancias(&self) -> Result<PathBuf, String> {
        self.instances_path
            .lock()
            .map(|caminho| caminho.clone())
            .map_err(|_| "Falha ao acessar a pasta de instâncias".to_string())
    }

    pub fn atualizar_caminho_instancias(&self, caminho: PathBuf) -> Result<(), String> {
        migrar_pastas_auxiliares_instancias(&caminho)?;
        let mut caminho_atual = self
            .instances_path
            .lock()
            .map_err(|_| "Falha ao atualizar a pasta de instâncias".to_string())?;
        *caminho_atual = caminho;
        Ok(())
    }

    pub fn new() -> Self {
        // Determinar o caminho correto para dados do launcher
        let data_path = pasta_dados_launcher();
        if let Err(e) = std::fs::create_dir_all(&data_path) {
            eprintln!("Warning: Could not create data directory: {}", e);
        }

        let instances_path =
            match crate::comandos::configuracoes_java::carregar_configuracoes_locais() {
                Ok(configuracoes) => {
                    let caminho = PathBuf::from(configuracoes.instances_path);
                    if caminho.is_absolute() {
                        caminho
                    } else {
                        eprintln!("[Instâncias] Caminho configurado não é absoluto; usando o local padrão.");
                        crate::comandos::configuracoes_java::get_default_instances_path()
                    }
                }
                Err(erro) => {
                    eprintln!(
                        "[Instâncias] Configuração de pasta inválida ({}); usando o local padrão.",
                        erro
                    );
                    crate::comandos::configuracoes_java::get_default_instances_path()
                }
            };

        // Criar o diretório se não existir
        if let Err(e) = std::fs::create_dir_all(&instances_path) {
            eprintln!("Warning: Could not create instances directory: {}", e);
        }
        if let Err(erro) = migrar_pastas_auxiliares_instancias(&instances_path) {
            eprintln!("[Instâncias] Aviso: não foi possível reorganizar pastas auxiliares: {erro}");
        }

        // Carregar contas salvas (multi-conta) e conta ativa.
        let accounts = Self::load_saved_accounts(&data_path);
        let account = Self::load_saved_account(&data_path).or_else(|| accounts.first().cloned());

        let state = Self {
            account: Arc::new(Mutex::new(account)),
            accounts: Arc::new(Mutex::new(accounts)),
            instances_path: Arc::new(Mutex::new(instances_path)),
            processos_instancias: Arc::new(Mutex::new(HashMap::new())),
        };

        match crate::aplicacao::importacao_exportacao::atualizar_icones_instancias_modrinth_existentes(
            &state,
        ) {
            Ok(quantidade) if quantidade > 0 => {
                println!(
                    "[Instâncias] {} capa(s) importada(s) do Modrinth foram recuperadas.",
                    quantidade
                );
            }
            Err(erro) => {
                eprintln!(
                    "[Instâncias] Aviso: não foi possível recuperar capas do Modrinth: {}",
                    erro
                );
            }
            _ => {}
        }

        state
    }

    pub fn registrar_processo_instancia(&self, instance_id: &str, pid: u32) {
        if let Ok(mut processos) = self.processos_instancias.lock() {
            processos.insert(instance_id.to_string(), pid);
        }
    }

    pub fn obter_pid_instancia(&self, instance_id: &str) -> Option<u32> {
        self.processos_instancias
            .lock()
            .ok()
            .and_then(|processos| processos.get(instance_id).copied())
    }

    pub fn remover_pid_instancia(&self, instance_id: &str) {
        if let Ok(mut processos) = self.processos_instancias.lock() {
            processos.remove(instance_id);
        }
    }

    /// Caminho para o arquivo de conta
    fn get_account_path() -> PathBuf {
        pasta_dados_launcher().join("account.json")
    }

    /// Caminho para o arquivo de contas salvas (multi-conta)
    fn get_accounts_path() -> PathBuf {
        pasta_dados_launcher().join("accounts.json")
    }

    /// Carrega a conta salva do arquivo
    fn load_saved_account(data_path: &std::path::Path) -> Option<MinecraftAccount> {
        let account_path = data_path.join("account.json");

        if account_path.exists() {
            match ler_json_seguro::<MinecraftAccount>(&account_path) {
                Ok((account, protegido)) => {
                    if !protegido {
                        if let Err(e) = escrever_json_seguro(&account_path, &account) {
                            eprintln!(
                                "[Auth] Aviso: erro ao migrar conta para formato protegido: {}",
                                e
                            );
                        }
                    }

                    println!(
                        "[Auth] Conta carregada: {} ({})",
                        account.name, account.uuid
                    );

                    return Some(account);
                }
                Err(e) => {
                    eprintln!("[Auth] Erro ao carregar conta salva: {}", e);
                }
            }
        }

        None
    }

    /// Carrega todas as contas salvas para seleção rápida.
    fn load_saved_accounts(data_path: &std::path::Path) -> Vec<MinecraftAccount> {
        let accounts_path = data_path.join("accounts.json");
        let mut contas: Vec<MinecraftAccount> = Vec::new();

        if accounts_path.exists() {
            match ler_json_seguro::<Vec<MinecraftAccount>>(&accounts_path) {
                Ok((mut parsed, protegido)) => {
                    // Remover duplicadas por UUID, preservando a primeira ocorrência.
                    let mut uuids = HashSet::new();
                    parsed.retain(|conta| uuids.insert(conta.uuid.clone()));
                    if !protegido {
                        if let Err(e) = escrever_json_seguro(&accounts_path, &parsed) {
                            eprintln!(
                                "[Auth] Aviso: erro ao migrar lista de contas para formato protegido: {}",
                                e
                            );
                        }
                    }
                    contas = parsed;
                }
                Err(e) => {
                    eprintln!("[Auth] Erro ao carregar lista de contas salva: {}", e);
                }
            }
        }

        // Fallback para formato antigo (conta única).
        if contas.is_empty() {
            if let Some(conta_unica) = Self::load_saved_account(data_path) {
                contas.push(conta_unica);
            }
        }

        contas
    }

    fn salvar_lista_contas(&self, contas: &[MinecraftAccount]) -> Result<(), String> {
        let accounts_path = Self::get_accounts_path();
        escrever_json_seguro(&accounts_path, &contas)
    }

    /// Salva a conta no arquivo
    pub fn save_account(&self, account: &MinecraftAccount) -> Result<(), String> {
        let account_path = Self::get_account_path();

        escrever_json_seguro(&account_path, account)?;

        if let Ok(mut atual) = self.account.lock() {
            *atual = Some(account.clone());
        }

        let contas_atualizadas = {
            let mut contas = self
                .accounts
                .lock()
                .map_err(|_| "Falha ao acessar lista de contas".to_string())?;

            if let Some(indice) = contas.iter().position(|conta| conta.uuid == account.uuid) {
                contas[indice] = account.clone();
            } else {
                contas.push(account.clone());
            }

            contas.clone()
        };

        self.salvar_lista_contas(&contas_atualizadas)?;

        println!("[Auth] Conta salva: {} ({})", account.name, account.uuid);
        Ok(())
    }

    /// Remove a conta salva (logout)
    pub fn clear_account(&self) -> Result<(), String> {
        let account_path = Self::get_account_path();

        if account_path.exists() {
            std::fs::remove_file(&account_path)
                .map_err(|e| format!("Erro ao remover arquivo de conta: {}", e))?;
        }

        // Limpar do estado
        if let Ok(mut acc) = self.account.lock() {
            *acc = None;
        }

        println!("[Auth] Conta removida (logout)");
        Ok(())
    }

    /// Remove todas as credenciais locais sem apagar instâncias, mundos ou configurações.
    pub fn clear_all_accounts(&self) -> Result<(), String> {
        for caminho in [Self::get_account_path(), Self::get_accounts_path()] {
            if caminho.exists() {
                std::fs::remove_file(&caminho)
                    .map_err(|e| format!("Erro ao remover credenciais locais: {e}"))?;
            }
        }

        *self
            .account
            .lock()
            .map_err(|_| "Falha ao limpar conta ativa".to_string())? = None;
        self.accounts
            .lock()
            .map_err(|_| "Falha ao limpar contas salvas".to_string())?
            .clear();
        Ok(())
    }

    pub fn list_accounts(&self) -> Vec<MinecraftAccount> {
        self.accounts
            .lock()
            .map(|contas| contas.clone())
            .unwrap_or_default()
    }

    pub fn set_active_account(&self, uuid: &str) -> Result<MinecraftAccount, String> {
        let conta = self
            .accounts
            .lock()
            .map_err(|_| "Falha ao acessar lista de contas".to_string())?
            .iter()
            .find(|conta| conta.uuid == uuid)
            .cloned()
            .ok_or("Conta não encontrada.".to_string())?;

        self.save_account(&conta)?;
        Ok(conta)
    }

    pub fn remove_account(&self, uuid: &str) -> Result<(), String> {
        let contas_atualizadas = {
            let mut contas = self
                .accounts
                .lock()
                .map_err(|_| "Falha ao acessar lista de contas".to_string())?;

            let quantidade_inicial = contas.len();
            contas.retain(|conta| conta.uuid != uuid);
            if contas.len() == quantidade_inicial {
                return Err("Conta não encontrada para remoção.".to_string());
            }

            contas.clone()
        };

        self.salvar_lista_contas(&contas_atualizadas)?;

        let ativa_eh_removida = self
            .account
            .lock()
            .map_err(|_| "Falha ao acessar sessão atual".to_string())?
            .as_ref()
            .map(|conta| conta.uuid == uuid)
            .unwrap_or(false);

        if ativa_eh_removida {
            self.clear_account()?;
        }

        Ok(())
    }

    pub fn get_instances(&self) -> Result<Vec<Instance>, String> {
        // Carregar instâncias do diretório
        let mut instances = Vec::new();
        let mut ids_vistos = HashSet::new();
        let instances_path = self.caminho_instancias()?;

        if let Ok(entries) = std::fs::read_dir(instances_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let config_path = entry.path().join("instance.json");
                    if config_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&config_path) {
                            match Self::ler_instancia_do_conteudo(&content) {
                                Ok((mut instance, recuperada)) => {
                                    let pasta_nome =
                                        entry.file_name().to_string_lossy().to_string();
                                    let mut precisa_salvar = recuperada;

                                    // Garantir que id e path reflitam o diretório real no disco (cura instâncias dessincronizadas)
                                    if instance.id != pasta_nome {
                                        instance.id = pasta_nome.clone();
                                        precisa_salvar = true;
                                    }
                                    if instance.path != entry.path() {
                                        instance.path = entry.path();
                                        precisa_salvar = true;
                                    }
                                    if instance.name.trim().is_empty() {
                                        instance.name = pasta_nome.clone();
                                        precisa_salvar = true;
                                    }

                                    let id = instance.id.clone();
                                    if instance.last_played.as_deref() == Some("Nunca") {
                                        instance.last_played = None;
                                        precisa_salvar = true;
                                    }

                                    // Para instâncias de modpack antigas, recuperar ícone real salvo em modpack.json.
                                    let icone_generico = instance
                                        .icon
                                        .as_deref()
                                        .map(|icone| icone.contains("api.dicebear.com"))
                                        .unwrap_or(true);
                                    if icone_generico {
                                        let caminho_modpack = entry.path().join("modpack.json");
                                        if caminho_modpack.exists() {
                                            let mut encontrou_icone_modpack = false;
                                            if let Ok(conteudo_modpack) =
                                                std::fs::read_to_string(&caminho_modpack)
                                            {
                                                if let Ok(json_modpack) =
                                                    serde_json::from_str::<serde_json::Value>(
                                                        &conteudo_modpack,
                                                    )
                                                {
                                                    if let Some(icone_modpack) = json_modpack
                                                        ["icon"]
                                                        .as_str()
                                                        .map(|valor| valor.trim().to_string())
                                                        .filter(|valor| !valor.is_empty())
                                                    {
                                                        instance.icon = Some(icone_modpack);
                                                        encontrou_icone_modpack = true;
                                                        precisa_salvar = true;
                                                    }
                                                }
                                            }
                                            if !encontrou_icone_modpack {
                                                instance.icon = None;
                                            }
                                        }
                                    }

                                    if precisa_salvar {
                                        Self::salvar_instancia_em_arquivo(&config_path, &instance);
                                    }

                                    if !ids_vistos.insert(id.clone()) {
                                        println!(
                                            "Instância duplicada ignorada (id repetido): {} em {:?}",
                                            id,
                                            entry.path()
                                        );
                                        continue;
                                    }
                                    instances.push(instance);
                                }
                                Err(e) => {
                                    println!("Erro ao parsear instance.json: {}", e);
                                }
                            }
                        } else {
                            println!("Erro ao ler instance.json");
                        }
                    }
                }
            }
        }
        Ok(instances)
    }
}

#[cfg(test)]
mod testes_instancias {
    use super::LauncherState;

    const INSTANCIA_VALIDA: &str = r#"{
        "id": "teste",
        "name": "Teste",
        "version": "1.21.1",
        "mcType": "vanilla",
        "path": "C:\\instancias\\teste",
        "created": "2026-09-19T00:00:00Z"
    }"#;

    #[test]
    fn recupera_instancia_com_residuo_apos_json() {
        let conteudo = format!("{}l\n}}", INSTANCIA_VALIDA);
        let (instancia, recuperada) = LauncherState::ler_instancia_do_conteudo(&conteudo).unwrap();

        assert_eq!(instancia.id, "teste");
        assert!(recuperada);
    }

    #[test]
    fn rejeita_instancia_sem_json_valido_no_inicio() {
        assert!(LauncherState::ler_instancia_do_conteudo("lixo antes do json").is_err());
    }
}

// ===== APIs PARA PLATAFORMAS =====
// Implementações movidas para lib.rs para melhor integração com Tauri
