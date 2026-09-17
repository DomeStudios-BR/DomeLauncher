use super::*;
use base64::Engine as _;

const LIMITE_ICONE_INSTANCIA_BYTES: usize = 1024 * 1024;
const LIMITE_CAPTURA_PERFIL_BYTES: u64 = 8 * 1024 * 1024;
const LIMITE_CAPTURAS_PERFIL: usize = 240;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturaPerfil {
    nome: String,
    instancia_id: String,
    instancia_nome: String,
    criada_em: Option<String>,
    dados_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaginaCapturasPerfil {
    capturas: Vec<CapturaPerfil>,
    total: usize,
    pagina: usize,
    total_paginas: usize,
}

fn mime_captura(caminho: &std::path::Path) -> Option<&'static str> {
    match caminho
        .extension()?
        .to_string_lossy()
        .to_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        _ => None,
    }
}

pub(crate) fn validar_icone_instancia(icone: &str) -> Result<(), String> {
    let dados_base64 = icone
        .strip_prefix("data:image/png;base64,")
        .ok_or_else(|| "A imagem da instância deve estar no formato PNG.".to_string())?;
    let dados = base64::engine::general_purpose::STANDARD
        .decode(dados_base64)
        .map_err(|_| "A imagem da instância é inválida.".to_string())?;
    if !dados.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("O conteúdo da imagem da instância não é um PNG válido.".to_string());
    }
    if dados.len() > LIMITE_ICONE_INSTANCIA_BYTES {
        return Err("A imagem processada deve ter no máximo 1 MB.".to_string());
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn get_minecraft_versions() -> Result<VersionManifest, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let manifest = res
        .json::<VersionManifest>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifest)
}

#[tauri::command]
pub(crate) fn get_instances(state: State<LauncherState>) -> Result<Vec<Instance>, String> {
    state.get_instances().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn listar_capturas_perfil(
    state: State<LauncherState>,
    pagina: Option<usize>,
    tamanho_pagina: Option<usize>,
) -> Result<PaginaCapturasPerfil, String> {
    let instancias = state.get_instances().map_err(|e| e.to_string())?;
    let mut arquivos = Vec::new();

    for instancia in instancias {
        let pasta = instancia.path.join("screenshots");
        let Ok(entradas) = std::fs::read_dir(pasta) else {
            continue;
        };

        for entrada in entradas.flatten() {
            let caminho = entrada.path();
            let Some(mime) = mime_captura(&caminho) else {
                continue;
            };
            let Ok(metadados) = entrada.metadata() else {
                continue;
            };
            if !metadados.is_file() || metadados.len() > LIMITE_CAPTURA_PERFIL_BYTES {
                continue;
            }

            arquivos.push((
                metadados.modified().ok(),
                caminho,
                mime,
                instancia.id.clone(),
                instancia.name.clone(),
            ));
        }
    }

    arquivos.sort_by_key(|arquivo| std::cmp::Reverse(arquivo.0));
    arquivos.truncate(LIMITE_CAPTURAS_PERFIL);
    let total = arquivos.len();
    let tamanho = tamanho_pagina.unwrap_or(12).clamp(1, 24);
    let pagina_atual = pagina.unwrap_or(1).max(1);
    let inicio = (pagina_atual - 1).saturating_mul(tamanho).min(total);
    let fim = (inicio + tamanho).min(total);
    let total_paginas = total.div_ceil(tamanho).max(1);

    let capturas = arquivos
        .into_iter()
        .skip(inicio)
        .take(fim - inicio)
        .filter_map(
            |(modificada_em, caminho, mime, instancia_id, instancia_nome)| {
                let bytes = std::fs::read(&caminho).ok()?;
                let conteudo = base64::engine::general_purpose::STANDARD.encode(bytes);
                let criada_em = modificada_em
                    .map(chrono::DateTime::<chrono::Utc>::from)
                    .map(|data| data.to_rfc3339());
                Some(CapturaPerfil {
                    nome: caminho.file_stem()?.to_string_lossy().to_string(),
                    instancia_id,
                    instancia_nome,
                    criada_em,
                    dados_url: format!("data:{mime};base64,{conteudo}"),
                })
            },
        )
        .collect();
    Ok(PaginaCapturasPerfil {
        capturas,
        total,
        pagina: pagina_atual,
        total_paginas,
    })
}

#[tauri::command]
pub(crate) async fn delete_instance(
    state: State<'_, LauncherState>,
    id: String,
) -> Result<(), String> {
    let instance_path = caminho_instancia_por_id(&state, &id)?;
    if instance_path.exists() {
        std::fs::remove_dir_all(instance_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn abrir_pasta_instancia(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<(), String> {
    let caminho = caminho_instancia_por_id(&state, &instance_id)?;
    if !caminho.is_dir() {
        return Err(format!(
            "A pasta da instância '{}' não existe.",
            instance_id
        ));
    }

    open::that(caminho).map_err(|e| format!("Erro ao abrir pasta da instância: {}", e))
}

#[tauri::command]
pub(crate) fn open_browser(url: String) -> Result<(), String> {
    let url = url::Url::parse(url.trim()).map_err(|_| "URL inválida.".to_string())?;
    if url.scheme() != "https" {
        return Err("Apenas endereços HTTPS podem ser abertos.".to_string());
    }

    open::that(url.as_str()).map_err(|e| e.to_string())
}

// ===== COMANDOS PARA GERENCIAMENTO DE MODS =====

// Funções antigas removidas - funcionalidades implementadas diretamente no código

// ===== COMANDOS PARA GERENCIAMENTO DE INSTÂNCIAS =====

#[tauri::command]
pub(crate) async fn get_instance_details(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<Instance, String> {
    state
        .get_instances()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|instancia| instancia.id == instance_id)
        .ok_or_else(|| format!("Instância '{}' não encontrada", instance_id))
}

#[tauri::command]
pub(crate) async fn update_instance_name(
    state: State<'_, LauncherState>,
    instance_id: String,
    new_name: String,
) -> Result<(), String> {
    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

    instance.name = new_name;

    let new_content = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;

    std::fs::write(&config_path, new_content)
        .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn update_instance_icon(
    state: State<'_, LauncherState>,
    instance_id: String,
    icon: String,
) -> Result<(), String> {
    validar_icone_instancia(&icon)?;
    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;
    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;
    instance.icon = Some(icon);

    let new_content = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;
    std::fs::write(&config_path, new_content)
        .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_instance_settings(
    state: State<'_, LauncherState>,
    instance_id: String,
    memory: Option<u32>,
    usar_memoria_personalizada: Option<bool>,
    java_args: Option<String>,
    usar_argumentos_jvm_personalizados: Option<bool>,
    mc_args: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    let config_path = instance_path.join("instance.json");

    if !config_path.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

    let mut instance: Instance = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

    if let Some(usar_memoria) = usar_memoria_personalizada {
        if usar_memoria {
            let memoria = memory.ok_or(
                "Informe a memória da instância ao ativar a alocação personalizada.".to_string(),
            )?;
            if !(512..=65536).contains(&memoria) {
                return Err("Memória da instância deve estar entre 512 e 65536 MB.".to_string());
            }
            instance.memory = Some(memoria);
        } else {
            instance.memory = None;
        }
    }

    if let Some(usar_argumentos) = usar_argumentos_jvm_personalizados {
        instance.java_args = if usar_argumentos {
            Some(java_args.unwrap_or_default().trim().to_string())
        } else {
            None
        };
    } else if let Some(java_args_valor) = java_args {
        let texto = java_args_valor.trim();
        instance.java_args = if texto.is_empty() {
            None
        } else {
            Some(texto.to_string())
        };
    }

    if let Some(mc_args_valor) = mc_args {
        let texto = mc_args_valor.trim();
        instance.mc_args = if texto.is_empty() {
            None
        } else {
            Some(texto.to_string())
        };
    }

    if let Some(largura) = width {
        if !(320..=7680).contains(&largura) {
            return Err("Largura da janela deve estar entre 320 e 7680.".to_string());
        }
        instance.width = Some(largura);
    }

    if let Some(altura) = height {
        if !(240..=4320).contains(&altura) {
            return Err("Altura da janela deve estar entre 240 e 4320.".to_string());
        }
        instance.height = Some(altura);
    }

    let new_content = serde_json::to_string_pretty(&instance)
        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;

    std::fs::write(&config_path, new_content)
        .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;

    Ok(())
}

pub(super) fn normalizar_nome_pasta_instancia(nome: &str) -> String {
    let mut resultado = String::new();
    let mut ultimo_foi_separador = false;

    for caractere in nome.trim().to_lowercase().chars() {
        let permitido = caractere.is_alphanumeric() || matches!(caractere, '-' | '_');
        if permitido {
            resultado.push(caractere);
            ultimo_foi_separador = false;
            continue;
        }

        if !ultimo_foi_separador {
            resultado.push('_');
            ultimo_foi_separador = true;
        }
    }

    let resultado = resultado
        .trim_matches(['.', '_'])
        .chars()
        .take(80)
        .collect::<String>();
    let nomes_reservados = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];

    if nomes_reservados.contains(&resultado.as_str()) {
        return format!("{}_instancia", resultado);
    }

    resultado
}

#[tauri::command]
pub(crate) async fn rename_instance_folder(
    state: State<'_, LauncherState>,
    instance_id: String,
    new_folder_name: String,
) -> Result<String, String> {
    let id_base = normalizar_nome_pasta_instancia(&new_folder_name);
    if id_base.is_empty() {
        return Err("Nome da pasta não pode ser vazio".to_string());
    }

    let pasta_atual = caminho_instancia_por_id(&state, &instance_id)?;
    if !pasta_atual.exists() {
        return Err(format!("Instância '{}' não encontrada", instance_id));
    }

    if instance_id == id_base {
        return Ok(instance_id);
    }

    let mut novo_id = id_base.clone();
    let mut contador = 2;
    let pasta_nova = loop {
        let candidata = caminho_instancia_por_id(&state, &novo_id)?;
        if !candidata.exists() {
            break candidata;
        }
        novo_id = format!("{}_{}", id_base, contador);
        contador += 1;
    };

    std::fs::rename(&pasta_atual, &pasta_nova)
        .map_err(|e| format!("Erro ao renomear pasta da instância: {}", e))?;

    let config_path = pasta_nova.join("instance.json");
    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;

        let mut instance: Instance = serde_json::from_str(&content)
            .map_err(|e| format!("Erro ao parsear instance.json: {}", e))?;

        instance.id = novo_id.clone();
        instance.path = pasta_nova.clone();

        let new_content = serde_json::to_string_pretty(&instance)
            .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;

        std::fs::write(&config_path, new_content)
            .map_err(|e| format!("Erro ao salvar instance.json: {}", e))?;
    }

    Ok(novo_id)
}

#[cfg(test)]
mod testes {
    use super::{normalizar_nome_pasta_instancia, validar_icone_instancia};

    #[test]
    fn adapta_caracteres_invalidos_para_nome_de_pasta() {
        assert_eq!(
            normalizar_nome_pasta_instancia("Meu Modpack: 1.21?"),
            "meu_modpack_1_21"
        );
        assert_eq!(normalizar_nome_pasta_instancia("CON"), "con_instancia");
        assert_eq!(
            normalizar_nome_pasta_instancia("  Wynncraft  "),
            "wynncraft"
        );
    }

    #[test]
    fn valida_icone_png_embutido() {
        let png_um_pixel = "data:image/png;base64,\
            iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        assert!(validar_icone_instancia(png_um_pixel).is_ok());
        assert!(validar_icone_instancia("data:image/jpeg;base64,/9j/4AAQ").is_err());
        assert!(validar_icone_instancia("data:image/png;base64,AAAA").is_err());
    }
}

#[tauri::command]
pub(crate) fn reiniciar_aplicativo(app: tauri::AppHandle) {
    app.restart();
}
