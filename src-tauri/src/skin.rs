use reqwest::multipart::{Form, Part};
use reqwest::Client;
use std::borrow::Cow;
use tauri::command;

#[command]
pub async fn baixar_textura_minecraft(url: String) -> Result<Vec<u8>, String> {
    let mut endereco =
        reqwest::Url::parse(&url).map_err(|_| "URL de textura inválida.".to_string())?;
    if !matches!(endereco.scheme(), "http" | "https")
        || endereco.host_str() != Some("textures.minecraft.net")
        || endereco.port().is_some()
        || !endereco.username().is_empty()
        || endereco.password().is_some()
        || !endereco.path().starts_with("/texture/")
    {
        return Err("Origem de textura não permitida.".to_string());
    }
    endereco
        .set_scheme("https")
        .map_err(|_| "Protocolo inválido.".to_string())?;
    let cliente = Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|erro| erro.to_string())?;
    let mut resposta = cliente
        .get(endereco)
        .send()
        .await
        .map_err(|erro| erro.to_string())?
        .error_for_status()
        .map_err(|erro| erro.to_string())?;
    let mut bytes = Vec::new();
    while let Some(parte) = resposta.chunk().await.map_err(|erro| erro.to_string())? {
        if bytes.len() + parte.len() > 1_048_576 {
            return Err("A textura ultrapassa o limite de 1 MB.".to_string());
        }
        bytes.extend_from_slice(&parte);
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("A textura recebida não é PNG.".to_string());
    }
    Ok(bytes)
}

#[derive(serde::Deserialize)]
struct PerfilSkinMinecraft {
    #[serde(default)]
    skins: Vec<SkinMinecraft>,
    #[serde(default)]
    capes: Vec<CapaMinecraft>,
}

#[derive(serde::Deserialize)]
struct SkinMinecraft {
    #[serde(default)]
    state: String,
    #[serde(default)]
    variant: String,
    #[serde(default)]
    url: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CapaMinecraft {
    #[serde(default)]
    id: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    alias: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CosmeticosSkin {
    variant: String,
    skin_url: Option<String>,
    capes: Vec<CapaMinecraft>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinAtualBaixada {
    variant: String,
    bytes: Vec<u8>,
}

fn variante_skin_do_perfil(perfil: &PerfilSkinMinecraft) -> String {
    let skin = perfil
        .skins
        .iter()
        .find(|skin| skin.state.eq_ignore_ascii_case("active"))
        .or_else(|| perfil.skins.first());

    match skin.map(|skin| skin.variant.as_str()) {
        Some(variante) if variante.eq_ignore_ascii_case("slim") => "slim".to_string(),
        _ => "classic".to_string(),
    }
}

fn skin_ativa(perfil: &PerfilSkinMinecraft) -> Option<&SkinMinecraft> {
    perfil
        .skins
        .iter()
        .find(|skin| skin.state.eq_ignore_ascii_case("active"))
        .or_else(|| perfil.skins.first())
}

async fn consultar_perfil(access_token: &str) -> Result<PerfilSkinMinecraft, String> {
    let resposta = Client::new()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Falha ao consultar perfil do Minecraft: {}", e))?;

    if !resposta.status().is_success() {
        return Err(format!(
            "Não foi possível consultar o perfil do Minecraft ({})",
            resposta.status()
        ));
    }

    resposta
        .json::<PerfilSkinMinecraft>()
        .await
        .map_err(|e| format!("Resposta de perfil inválida: {}", e))
}

#[command]
pub async fn obter_variante_skin_atual(access_token: String) -> Result<String, String> {
    let perfil = consultar_perfil(&access_token).await?;
    Ok(variante_skin_do_perfil(&perfil))
}

#[command]
pub async fn obter_cosmeticos_skin(access_token: String) -> Result<CosmeticosSkin, String> {
    let perfil = consultar_perfil(&access_token).await?;
    Ok(CosmeticosSkin {
        variant: variante_skin_do_perfil(&perfil),
        skin_url: skin_ativa(&perfil)
            .map(|skin| skin.url.trim().to_string())
            .filter(|url| !url.is_empty()),
        capes: perfil.capes,
    })
}

#[command]
pub async fn baixar_skin_atual(access_token: String) -> Result<SkinAtualBaixada, String> {
    let perfil = consultar_perfil(&access_token).await?;
    let skin =
        skin_ativa(&perfil).ok_or_else(|| "O perfil não possui uma skin ativa.".to_string())?;
    if skin.url.trim().is_empty() {
        return Err("A skin ativa não possui uma textura válida.".to_string());
    }

    let resposta = Client::new()
        .get(&skin.url)
        .send()
        .await
        .map_err(|e| format!("Falha ao baixar a skin atual: {}", e))?;
    if !resposta.status().is_success() {
        return Err(format!(
            "Não foi possível baixar a skin atual ({})",
            resposta.status()
        ));
    }

    let bytes = resposta
        .bytes()
        .await
        .map_err(|e| format!("Falha ao ler a skin atual: {}", e))?;
    if bytes.len() > 1_048_576 {
        return Err("A textura da skin ultrapassa o limite de 1 MB.".to_string());
    }

    Ok(SkinAtualBaixada {
        variant: variante_skin_do_perfil(&perfil),
        bytes: bytes.to_vec(),
    })
}

#[command]
pub async fn equipar_capa(access_token: String, cape_id: Option<String>) -> Result<(), String> {
    let client = Client::new();
    let requisicao = if let Some(id) = cape_id {
        if id.is_empty()
            || id.len() > 100
            || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("Identificador de capa inválido.".to_string());
        }
        client
            .put("https://api.minecraftservices.com/minecraft/profile/capes/active")
            .bearer_auth(&access_token)
            .json(&serde_json::json!({ "capeId": id }))
    } else {
        client
            .delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
            .bearer_auth(&access_token)
    };

    let resposta = requisicao
        .send()
        .await
        .map_err(|e| format!("Falha ao atualizar a capa: {}", e))?;
    if !resposta.status().is_success() {
        let status = resposta.status();
        let texto = resposta.text().await.unwrap_or_default();
        return Err(format!("Erro Mojang API ({}): {}", status, texto));
    }

    Ok(())
}

#[command]
pub async fn upload_skin(
    access_token: String,
    variant: String,
    skin_bytes: Vec<u8>,
) -> Result<(), String> {
    let client = Client::new();

    if variant != "classic" && variant != "slim" {
        return Err("Variante inválida. Use 'classic' ou 'slim'.".to_string());
    }

    let part = Part::bytes(Cow::from(skin_bytes))
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;

    let form = Form::new().text("variant", variant).part("file", part);

    let res = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(access_token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Erro Mojang API ({}): {}", status, text));
    }

    Ok(())
}

#[cfg(test)]
mod testes {
    use super::{variante_skin_do_perfil, PerfilSkinMinecraft, SkinMinecraft};

    #[test]
    fn prioriza_variante_da_skin_ativa() {
        let perfil = PerfilSkinMinecraft {
            skins: vec![
                SkinMinecraft {
                    state: "INACTIVE".to_string(),
                    variant: "CLASSIC".to_string(),
                    url: String::new(),
                },
                SkinMinecraft {
                    state: "ACTIVE".to_string(),
                    variant: "SLIM".to_string(),
                    url: String::new(),
                },
            ],
            capes: Vec::new(),
        };

        assert_eq!(variante_skin_do_perfil(&perfil), "slim");
    }
}
