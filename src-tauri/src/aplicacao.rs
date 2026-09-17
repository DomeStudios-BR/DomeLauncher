use crate::comandos::instancia_sistema::{
    caminho_instancia_por_id, obter_instancia_por_id, validar_caminho_dentro_raiz,
};
use crate::launcher::{
    Instance, LauncherState, LoaderType, ModInfo, ModPlatform, VersionDetail, VersionManifest,
};
use serde::{Deserialize, Serialize};
use tauri::State;

mod bootstrap;
mod conteudo_instalado;
mod downloads_instancias;
pub(crate) mod importacao_exportacao;
mod instancias_basicas;
mod instancias_criacao;
mod lancamento_jogo;
mod mods_conteudo;
mod sincronizacao_instancias;

// Constantes das APIs
const CURSEFORGE_API_KEY_FALLBACK: &str =
    "$2a$10$wuAJuNZuted3NORVmpgUC.m8sI.pv1tOPKZyBgLFGjxFp/br0lZCC";
pub(crate) const CURSEFORGE_API_BASE: &str = "https://api.curseforge.com/v1";
const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

fn normalizar_chave_api_curseforge(valor: String) -> Option<String> {
    let chave = valor.trim().to_string();
    if chave.is_empty() {
        None
    } else {
        Some(chave)
    }
}

fn obter_chave_api_curseforge() -> Option<String> {
    let chave_env = std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .and_then(normalizar_chave_api_curseforge);

    chave_env.or_else(|| normalizar_chave_api_curseforge(CURSEFORGE_API_KEY_FALLBACK.to_string()))
}

pub(crate) fn anexar_headers_curseforge(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::RequestBuilder, String> {
    let chave = obter_chave_api_curseforge().ok_or_else(|| {
        "Chave da API CurseForge indisponível. Defina CURSEFORGE_API_KEY no ambiente.".to_string()
    })?;

    Ok(request
        .header("x-api-key", chave)
        .header("Accept", "application/json"))
}

fn class_id_por_tipo_conteudo(tipo: &str) -> u32 {
    match tipo {
        "modpack" => 4471,
        "resourcepack" => 12,
        "shader" => 6552,
        _ => 6, // mod
    }
}

fn rota_curseforge_por_tipo_conteudo(tipo: &str) -> &'static str {
    match tipo {
        "modpack" => "modpacks",
        "resourcepack" => "texture-packs",
        "shader" => "shaders",
        _ => "mc-mods",
    }
}

fn extrair_slug_de_url_curseforge(url: &str) -> Option<String> {
    let sem_query = url.split('?').next().unwrap_or(url);
    sem_query
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|slug| !slug.is_empty())
        .map(|slug| slug.to_string())
}

fn texto_json_caminho(valor: &serde_json::Value, caminho: &[&str]) -> Option<String> {
    let mut atual = valor;
    for chave in caminho {
        atual = atual.get(*chave)?;
    }
    atual
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parsear_cfg_simples(caminho: &std::path::Path) -> std::collections::HashMap<String, String> {
    let mut resultado = std::collections::HashMap::new();
    let conteudo = match std::fs::read_to_string(caminho) {
        Ok(valor) => valor,
        Err(_) => return resultado,
    };

    for linha in conteudo.lines() {
        let linha = linha.trim();
        if linha.is_empty() || linha.starts_with('#') || linha.starts_with(';') {
            continue;
        }

        let mut partes = linha.splitn(2, '=');
        let chave = partes.next().unwrap_or("").trim();
        let valor = partes.next().unwrap_or("").trim();
        if chave.is_empty() {
            continue;
        }
        resultado.insert(chave.to_string(), valor.to_string());
    }

    resultado
}

fn detectar_loader_normalizado(loader: Option<&str>) -> Option<String> {
    let bruto = loader?.trim().to_lowercase();
    if bruto.is_empty() {
        return None;
    }

    if bruto.contains("neoforge") || bruto.contains("neoforged") {
        return Some("neoforge".to_string());
    }
    if bruto.contains("fabric") {
        return Some("fabric".to_string());
    }
    if bruto.contains("quilt") {
        return Some("quilt".to_string());
    }
    if bruto.contains("forge") {
        return Some("forge".to_string());
    }
    if bruto.contains("vanilla") {
        return Some("vanilla".to_string());
    }

    Some(bruto)
}

fn rotulo_loader(loader_normalizado: Option<&str>) -> Option<String> {
    match loader_normalizado {
        Some("forge") => Some("Forge".to_string()),
        Some("fabric") => Some("Fabric".to_string()),
        Some("neoforge") => Some("NeoForge".to_string()),
        Some("quilt") => Some("Quilt".to_string()),
        Some("vanilla") => Some("Vanilla".to_string()),
        Some(outro) => Some(outro.to_string()),
        None => None,
    }
}

fn detectar_caminho_jogo(base: &std::path::Path) -> std::path::PathBuf {
    let candidatos = [
        base.join(".minecraft"),
        base.join("minecraft"),
        base.to_path_buf(),
    ];
    candidatos
        .into_iter()
        .find(|caminho| caminho.exists() && caminho.is_dir())
        .unwrap_or_else(|| base.to_path_buf())
}

pub use bootstrap::run;
pub(crate) use lancamento_jogo::timestamp_atual_segundos;
