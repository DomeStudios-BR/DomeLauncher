use crate::comandos::instancia_sistema::{
    nome_arquivo_valido_log, obter_instancia_por_id, validar_caminho_dentro_raiz,
};
use crate::launcher::{Instance, LauncherState};
use serde::{Deserialize, Serialize};
use tauri::State;

#[tauri::command]
pub async fn obter_logs_relato_instancia(
    instance_id: String,
    state: State<'_, LauncherState>,
) -> Result<String, String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    tauri::async_runtime::spawn_blocking(move || coletar_logs_relato(&instancia.path))
        .await
        .map_err(|_| "Não foi possível preparar os logs do Minecraft.".to_string())?
}

fn coletar_logs_relato(raiz: &std::path::Path) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut resultado = String::new();
    for nome in ["dome-console.log", "latest.log"] {
        let caminho = raiz.join("logs").join(nome);
        if !caminho.exists() {
            continue;
        }
        let seguro = validar_caminho_dentro_raiz(raiz, &caminho)?;
        let mut arquivo = std::fs::File::open(seguro).map_err(|erro| erro.to_string())?;
        let tamanho = arquivo.metadata().map_err(|erro| erro.to_string())?.len();
        arquivo
            .seek(SeekFrom::Start(tamanho.saturating_sub(8000)))
            .map_err(|erro| erro.to_string())?;
        let mut bytes = Vec::new();
        arquivo
            .take(8000)
            .read_to_end(&mut bytes)
            .map_err(|erro| erro.to_string())?;
        resultado.push_str(&format!("\n{nome}:\n{}", String::from_utf8_lossy(&bytes)));
    }
    Ok(resultado)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub filename: String,
    pub path: String,
    pub size: u64,
    pub modified: String,
}

fn validar_caminho_log_instancia(
    instance: &Instance,
    file_path: &str,
) -> Result<std::path::PathBuf, String> {
    let logs_dir = instance.path.join("logs");
    if !logs_dir.exists() {
        return Err("Diretório de logs da instância não encontrado.".to_string());
    }

    let nome_arquivo = std::path::Path::new(file_path)
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or("Nome de arquivo de log inválido.")?;

    if !nome_arquivo_valido_log(nome_arquivo) {
        return Err("Apenas arquivos .log ou .txt são permitidos.".to_string());
    }

    let caminho_candidato = logs_dir.join(nome_arquivo);
    if !caminho_candidato.exists() {
        return Err("Arquivo de log não encontrado.".to_string());
    }

    validar_caminho_dentro_raiz(&logs_dir, &caminho_candidato)
}

#[tauri::command]
pub fn get_log_files(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<LogFile>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let logs_dir = instance.path.join("logs");
    let mut log_files = vec![];

    if logs_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(logs_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        let filename = entry.file_name().to_str().unwrap_or("").to_string();
                        if filename.ends_with(".log") || filename.ends_with(".txt") {
                            let modified = metadata
                                .modified()
                                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs();

                            log_files.push(LogFile {
                                filename: filename.clone(),
                                path: entry.path().to_str().unwrap_or("").to_string(),
                                size: metadata.len(),
                                modified: format!("{}", modified),
                            });
                        }
                    }
                }
            }
        }
    }

    // Adicionar latest.log se existir
    let latest_log = instance.path.join("logs").join("latest.log");
    if latest_log.exists() {
        if let Ok(metadata) = latest_log.metadata() {
            let modified = metadata
                .modified()
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();

            log_files.push(LogFile {
                filename: "latest.log".to_string(),
                path: latest_log.to_str().unwrap_or("").to_string(),
                size: metadata.len(),
                modified: format!("{}", modified),
            });
        }
    }

    Ok(log_files)
}

#[tauri::command]
pub fn get_log_content(
    instance_id: String,
    file_path: String,
    state: State<LauncherState>,
) -> Result<String, String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let caminho_log = validar_caminho_log_instancia(&instance, &file_path)?;
    std::fs::read_to_string(caminho_log).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_log_file(
    instance_id: String,
    file_path: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instance = obter_instancia_por_id(&state, &instance_id)?;
    let caminho_log = validar_caminho_log_instancia(&instance, &file_path)?;
    std::fs::remove_file(caminho_log).map_err(|e| e.to_string())
}

#[cfg(test)]
mod testes_relato {
    use super::*;

    #[test]
    fn coleta_final_dos_logs_com_limite_sem_modificar_originais() {
        let raiz = std::env::temp_dir().join(format!("dome-relato-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(raiz.join("logs")).unwrap();
        let console = format!("{}FALHA_JAVA", "a".repeat(20000));
        std::fs::write(raiz.join("logs/dome-console.log"), &console).unwrap();
        std::fs::write(raiz.join("logs/latest.log"), "Última mensagem do jogo").unwrap();
        let resultado = coletar_logs_relato(&raiz).unwrap();
        assert!(resultado.contains("FALHA_JAVA"));
        assert!(resultado.contains("Última mensagem do jogo"));
        assert!(resultado.len() < 8100);
        assert_eq!(
            std::fs::read_to_string(raiz.join("logs/dome-console.log")).unwrap(),
            console
        );
        std::fs::remove_dir_all(raiz).unwrap();
    }
}
