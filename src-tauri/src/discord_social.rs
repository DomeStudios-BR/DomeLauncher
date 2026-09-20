use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use reqwest::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use tokio::time::{timeout, Duration};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BodyExchangeDiscord {
    code: String,
    code_verifier: String,
    redirect_uri: String,
}

fn normalizar_api_base_url(api_base_url: &str) -> Result<String, String> {
    let api_base = api_base_url.trim().trim_end_matches('/').to_string();
    if api_base.is_empty() {
        return Err("URL da API do launcher nao configurada.".to_string());
    }
    if !api_base.starts_with("http://") && !api_base.starts_with("https://") {
        return Err("URL da API do launcher invalida.".to_string());
    }
    Ok(api_base)
}

fn gerar_code_verifier() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn gerar_code_challenge(code_verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

#[tauri::command]
pub async fn login_discord_social(
    app: AppHandle,
    api_base_url: String,
    client_id: String,
    redirect_uri: String,
    scope: Option<String>,
    access_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let api_base_url = normalizar_api_base_url(&api_base_url)?;
    let client_id = client_id.trim().to_string();
    let redirect_uri = redirect_uri.trim().to_string();
    let scope = scope
        .unwrap_or_else(|| "identify".to_string())
        .trim()
        .to_string();

    if client_id.is_empty() || redirect_uri.is_empty() {
        return Err("Parametros Discord incompletos para autenticacao social.".to_string());
    }

    let code_verifier = gerar_code_verifier();
    let code_challenge = gerar_code_challenge(&code_verifier);

    let estado = uuid::Uuid::new_v4().to_string();
    let mut url = url::Url::parse("https://discord.com/oauth2/authorize")
        .map_err(|e| format!("Falha ao montar URL OAuth: {}", e))?;

    url.query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", &scope)
        .append_pair("prompt", "consent")
        .append_pair("state", &estado)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");

    let (tx_callback, rx_callback) = oneshot::channel::<String>();
    let tx_callback = std::sync::Arc::new(std::sync::Mutex::new(Some(tx_callback)));

    let label = "discord-social-auth-window";
    if let Some(janela_existente) = app.get_webview_window(label) {
        let _ = janela_existente.close();
    }

    let tx_callback_janela = std::sync::Arc::clone(&tx_callback);
    let _janela = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url))
        .title("Entrar com Discord")
        .inner_size(500.0, 650.0)
        .on_navigation(move |url| {
            let possui_codigo = url.query_pairs().any(|(chave, _)| chave == "code");
            let possui_erro = url.query_pairs().any(|(chave, _)| chave == "error");
            if !possui_codigo && !possui_erro {
                return true;
            }

            if let Ok(mut sender_guard) = tx_callback_janela.lock() {
                if let Some(sender) = sender_guard.take() {
                    let _ = sender.send(url.to_string());
                }
            }

            false
        })
        .build()
        .map_err(|e| format!("Falha ao abrir janela de autenticacao: {}", e))?;

    let final_url = timeout(Duration::from_secs(180), rx_callback)
        .await
        .map_err(|_| "Tempo limite no login Discord. Tente novamente.".to_string())?
        .map_err(|_| "Fluxo OAuth encerrado antes do callback.".to_string())?;

    if let Some(janela) = app.get_webview_window(label) {
        let _ = janela.close();
    }

    let final_url =
        url::Url::parse(&final_url).map_err(|_| "URL final OAuth invalida".to_string())?;
    let query_params: std::collections::HashMap<String, String> =
        final_url.query_pairs().into_owned().collect();

    if let Some(erro) = query_params.get("error") {
        return Err(format!("Discord OAuth retornou erro: {}", erro));
    }

    let estado_retorno = query_params
        .get("state")
        .ok_or("Estado OAuth ausente".to_string())?;
    if estado_retorno != &estado {
        return Err("Estado OAuth invalido. Tente novamente.".to_string());
    }

    let code = query_params
        .get("code")
        .ok_or("Codigo OAuth nao encontrado no retorno.".to_string())?
        .to_string();

    let body = BodyExchangeDiscord {
        code,
        code_verifier,
        redirect_uri,
    };

    let vinculando = access_token
        .as_deref()
        .is_some_and(|token| !token.trim().is_empty());
    let endpoint = if vinculando {
        format!("{}/api/launcher/social/discord/link", api_base_url)
    } else {
        format!("{}/api/launcher/auth/discord/exchange", api_base_url)
    };
    let client = Client::new();
    let mut requisicao = client.post(&endpoint).json(&body);
    if let Some(token) = access_token.filter(|token| !token.trim().is_empty()) {
        requisicao = requisicao.bearer_auth(token.trim());
    }
    let resposta = requisicao
        .send()
        .await
        .map_err(|e| format!("Falha ao autenticar com API social: {}", e))?;

    if !resposta.status().is_success() {
        let texto = resposta.text().await.unwrap_or_default();
        return Err(format!("API social retornou erro: {}", texto));
    }

    resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta da API social invalida: {}", e))
}
