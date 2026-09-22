use super::*;
use base64::Engine as _;
use tauri::Emitter;

const LIMITE_ICONE_INSTANCIA_BYTES: usize = 1024 * 1024;
const LIMITE_CAPTURA_PERFIL_BYTES: u64 = 8 * 1024 * 1024;
const LIMITE_CAPTURAS_PERFIL: usize = 240;
const EVENTO_PROGRESSO_EXCLUSAO_INSTANCIA: &str = "instancia-exclusao-progresso";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressoExclusaoInstancia {
    id: String,
    etapa: String,
    itens_excluidos: usize,
    total_itens: usize,
    porcentagem: u8,
}

enum AlvoExclusao {
    Arquivo(std::path::PathBuf),
    Diretorio(std::path::PathBuf),
    LinkDiretorio(std::path::PathBuf),
}

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

fn calcular_porcentagem_exclusao(itens_excluidos: usize, total_itens: usize) -> u8 {
    if total_itens == 0 {
        return 0;
    }

    itens_excluidos
        .min(total_itens)
        .saturating_mul(100)
        .checked_div(total_itens)
        .unwrap_or(0) as u8
}

fn emitir_progresso_exclusao(
    app: &tauri::AppHandle,
    id: &str,
    etapa: &str,
    itens_excluidos: usize,
    total_itens: usize,
) {
    let porcentagem = if etapa == "concluida" {
        100
    } else {
        calcular_porcentagem_exclusao(itens_excluidos, total_itens)
    };
    let _ = app.emit(
        EVENTO_PROGRESSO_EXCLUSAO_INSTANCIA,
        ProgressoExclusaoInstancia {
            id: id.to_string(),
            etapa: etapa.to_string(),
            itens_excluidos,
            total_itens,
            porcentagem,
        },
    );
}

fn coletar_alvos_exclusao(
    caminho: &std::path::Path,
    alvos: &mut Vec<AlvoExclusao>,
) -> Result<(), String> {
    let metadados = std::fs::symlink_metadata(caminho)
        .map_err(|e| format!("Erro ao inspecionar item da instância: {}", e))?;

    if metadados.file_type().is_symlink() {
        let link_para_diretorio = std::fs::metadata(caminho)
            .map(|destino| destino.is_dir())
            .unwrap_or(false);
        alvos.push(if link_para_diretorio {
            AlvoExclusao::LinkDiretorio(caminho.to_path_buf())
        } else {
            AlvoExclusao::Arquivo(caminho.to_path_buf())
        });
        return Ok(());
    }

    if !metadados.is_dir() {
        alvos.push(AlvoExclusao::Arquivo(caminho.to_path_buf()));
        return Ok(());
    }

    let entradas = std::fs::read_dir(caminho)
        .map_err(|e| format!("Erro ao listar conteúdo da instância: {}", e))?;
    for entrada in entradas {
        let entrada = entrada.map_err(|e| format!("Erro ao ler item da instância: {}", e))?;
        coletar_alvos_exclusao(&entrada.path(), alvos)?;
    }
    alvos.push(AlvoExclusao::Diretorio(caminho.to_path_buf()));
    Ok(())
}

#[cfg(windows)]
fn excluir_link_diretorio(caminho: &std::path::Path) -> std::io::Result<()> {
    std::fs::remove_dir(caminho)
}

#[cfg(not(windows))]
fn excluir_link_diretorio(caminho: &std::path::Path) -> std::io::Result<()> {
    std::fs::remove_file(caminho)
}

fn excluir_pasta_instancia_com_progresso(
    caminho: &std::path::Path,
    id: &str,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    emitir_progresso_exclusao(app, id, "preparando", 0, 0);

    let mut alvos = Vec::new();
    coletar_alvos_exclusao(caminho, &mut alvos)?;
    let total_itens = alvos.len();
    let mut ultima_porcentagem = 0;
    emitir_progresso_exclusao(app, id, "excluindo", 0, total_itens);

    for (indice, alvo) in alvos.into_iter().enumerate() {
        match alvo {
            AlvoExclusao::Arquivo(arquivo) => std::fs::remove_file(&arquivo)
                .map_err(|e| format!("Erro ao excluir arquivo '{}': {}", arquivo.display(), e))?,
            AlvoExclusao::Diretorio(diretorio) => std::fs::remove_dir(&diretorio)
                .map_err(|e| format!("Erro ao excluir pasta '{}': {}", diretorio.display(), e))?,
            AlvoExclusao::LinkDiretorio(link) => excluir_link_diretorio(&link)
                .map_err(|e| format!("Erro ao excluir link '{}': {}", link.display(), e))?,
        }

        let itens_excluidos = indice + 1;
        let porcentagem = calcular_porcentagem_exclusao(itens_excluidos, total_itens);
        if porcentagem != ultima_porcentagem {
            ultima_porcentagem = porcentagem;
            emitir_progresso_exclusao(app, id, "excluindo", itens_excluidos, total_itens);
        }
    }

    emitir_progresso_exclusao(app, id, "concluida", total_itens, total_itens);
    Ok(())
}

#[tauri::command]
pub(crate) async fn delete_instance(
    state: State<'_, LauncherState>,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let raiz_instancias = state.caminho_instancias()?;
    let caminho_instancia = caminho_instancia_por_id(&state, &id)?;
    if !caminho_instancia.exists() {
        return Err(format!("Instância '{}' não encontrada para exclusão.", id));
    }

    let raiz_validada = raiz_instancias
        .canonicalize()
        .map_err(|e| format!("Falha ao normalizar raiz de segurança: {}", e))?;
    let caminho_validado = validar_caminho_dentro_raiz(&raiz_instancias, &caminho_instancia)?;
    if caminho_validado == raiz_validada {
        return Err("A raiz de instâncias não pode ser excluída.".to_string());
    }

    let app_tarefa = app.clone();
    let id_tarefa = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        excluir_pasta_instancia_com_progresso(&caminho_instancia, &id_tarefa, &app_tarefa)
    })
    .await
    .map_err(|e| format!("Falha ao executar exclusão da instância: {}", e))?
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
    if let Some(pasta_nome) = instance_path.file_name().and_then(|n| n.to_str()) {
        instance.id = pasta_nome.to_string();
    }
    instance.path = instance_path.clone();

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
        let config_path = pasta_atual.join("instance.json");
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(mut instance) = serde_json::from_str::<Instance>(&content) {
                    instance.name = new_folder_name;
                    instance.id = id_base.clone();
                    instance.path = pasta_atual.clone();
                    if let Ok(new_content) = serde_json::to_string_pretty(&instance) {
                        let _ = std::fs::write(&config_path, new_content);
                    }
                }
            }
        }
        return Ok(instance_id);
    }

    let mut novo_id = id_base.clone();
    let mut contador = 2;
    let pasta_nova = loop {
        let candidata = state.caminho_instancias()?.join(&novo_id);
        if !candidata.exists() {
            break candidata;
        }
        novo_id = format!("{}_{}", id_base, contador);
        contador += 1;
    };

    std::fs::rename(&pasta_atual, &pasta_nova)
        .map_err(|e| format!("Erro ao renomear pasta da instância: {}", e))?;

    let config_path = pasta_nova.join("instance.json");
    // Retry para Windows no caso de locks temporários (antivírus, indexador) logo após rename
    let mut salvou = false;
    for tentativa in 0..5 {
        if tentativa > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        }
        if config_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&config_path) {
                if let Ok(mut instance) = serde_json::from_str::<Instance>(&content) {
                    instance.id = novo_id.clone();
                    instance.path = pasta_nova.clone();
                    instance.name = new_folder_name.clone();

                    if let Ok(new_content) = serde_json::to_string_pretty(&instance) {
                        if std::fs::write(&config_path, new_content).is_ok() {
                            salvou = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    if !salvou {
        eprintln!(
            "[Instâncias] Aviso: falha temporária ao salvar instance.json após renomeação. Será autocorrigido ao carregar."
        );
    }

    Ok(novo_id)
}

#[cfg(test)]
mod testes {
    use super::{
        calcular_porcentagem_exclusao, normalizar_nome_pasta_instancia, validar_icone_instancia,
    };

    #[test]
    fn calcula_progresso_da_exclusao_e_limita_em_cem() {
        assert_eq!(calcular_porcentagem_exclusao(0, 0), 0);
        assert_eq!(calcular_porcentagem_exclusao(1, 4), 25);
        assert_eq!(calcular_porcentagem_exclusao(3, 4), 75);
        assert_eq!(calcular_porcentagem_exclusao(8, 4), 100);
    }

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
