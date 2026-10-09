use crate::launcher::{LauncherState, MinecraftAccount};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Utc};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use rand::Rng; // Trait for gen()
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

// Mojang/Microsoft Constants
const MICROSOFT_CLIENT_ID: &str = "00000000402b5328";
const REQUESTED_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";
const AUTH_REPLY_URL: &str = "https://login.live.com/oauth20_desktop.srf";
const TITLE_ID: &str = "1794566092"; // Launcher Title ID

// --- Structs ---

#[derive(Clone)]
pub struct DeviceTokenKey {
    pub id: Uuid,
    pub key: SigningKey,
    pub x: String,
    pub y: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct DeviceToken {
    pub issue_instant: DateTime<Utc>,
    pub not_after: DateTime<Utc>,
    pub token: String,
    pub display_claims: HashMap<String, serde_json::Value>,
}

pub struct RequestWithDate<T> {
    pub date: DateTime<Utc>,
    pub value: T,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RedirectUri {
    pub msa_oauth_redirect: String,
}

// --- Helper Functions ---

fn generate_key() -> Result<DeviceTokenKey, String> {
    // Generate P-256 EC Key pair
    let mut rng = rand::rngs::OsRng;
    let signing_key = SigningKey::random(&mut rng);
    let verifying_key = signing_key.verifying_key();
    let encoded_point = verifying_key.to_encoded_point(false);

    let x_bytes = encoded_point.x().ok_or("Failed to get X coordinate")?;
    let y_bytes = encoded_point.y().ok_or("Failed to get Y coordinate")?;

    let x = URL_SAFE_NO_PAD.encode(x_bytes);
    let y = URL_SAFE_NO_PAD.encode(y_bytes);

    Ok(DeviceTokenKey {
        id: Uuid::new_v4(),
        key: signing_key,
        x,
        y,
    })
}

fn generate_oauth_challenge() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.gen::<u8>()).collect();
    bytes.iter().map(|byte| format!("{:02x}", byte)).collect()
}

fn data_servidor(headers: &reqwest::header::HeaderMap) -> Option<DateTime<Utc>> {
    headers
        .get(reqwest::header::DATE)
        .and_then(|valor| valor.to_str().ok())
        .and_then(|valor| DateTime::parse_from_rfc2822(valor).ok())
        .map(|data| data.with_timezone(&Utc))
}

fn erro_xbox(status: reqwest::StatusCode, etapa: &str, corpo: &str) -> String {
    let codigo = serde_json::from_str::<serde_json::Value>(corpo)
        .ok()
        .and_then(|resposta| resposta.get("XErr").and_then(|valor| valor.as_u64()));
    let orientacao = match codigo {
        Some(2148916233) => "Entre em xbox.com e crie seu perfil Xbox antes de tentar novamente.",
        Some(2148916238) => "Confira as permissões da conta no grupo familiar Microsoft.",
        _ if status == reqwest::StatusCode::FORBIDDEN => {
            "Sincronize a data e a hora do computador e tente novamente. Se persistir, confira a conexão e o perfil em xbox.com."
        }
        _ => "Tente novamente em alguns instantes.",
    };
    let detalhe = codigo
        .map(|codigo| format!(", código Xbox {codigo}"))
        .unwrap_or_default();
    format!(
        "Falha no Xbox ao {etapa} (HTTP {}{detalhe}). {orientacao}",
        status.as_u16()
    )
}

fn assinatura_xbox(
    path_and_query: &str,
    corpo: &[u8],
    key: &DeviceTokenKey,
    current_date: DateTime<Utc>,
) -> String {
    // FILETIME usa intervalos de 100 ns desde 1601; a época Unix começa 11.644.473.600 segundos depois.
    let filetime = ((current_date.timestamp() as i128 + 11_644_473_600) * 10_000_000) as u64;
    let mut payload = Vec::new();
    for parte in [
        &1_u32.to_be_bytes()[..],
        &filetime.to_be_bytes()[..],
        b"POST",
        path_and_query.as_bytes(),
        b"",
        corpo,
    ] {
        payload.extend_from_slice(parte);
        payload.push(0);
    }
    let signature: Signature = key.key.sign(&payload);
    let mut header_bytes = Vec::new();
    header_bytes.extend_from_slice(&1_u32.to_be_bytes());
    header_bytes.extend_from_slice(&filetime.to_be_bytes());
    header_bytes.extend_from_slice(&signature.to_bytes());

    STANDARD.encode(header_bytes)
}

async fn send_signed_request<T: serde::de::DeserializeOwned>(
    client: &Client,
    url: &str,
    path_and_query: &str,
    body: serde_json::Value,
    key: &DeviceTokenKey,
    mut current_date: DateTime<Utc>,
) -> Result<(RequestWithDate<T>, reqwest::header::HeaderMap), String> {
    let etapa = match path_and_query {
        "/device/authenticate" => "autenticar o dispositivo",
        "/authenticate" => "iniciar o login Microsoft",
        "/authorize" => "autorizar a conta Microsoft",
        _ => "autenticar a conta",
    };
    let corpo = serde_json::to_vec(&body).map_err(|_| "Não foi possível preparar o login Xbox.")?;
    for tentativa in 0..2 {
        let mut requisicao = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header(
                "Signature",
                assinatura_xbox(path_and_query, &corpo, key, current_date),
            );
        if path_and_query != "/authorize" {
            requisicao = requisicao.header("x-xbl-contract-version", "1");
        }
        let resposta = requisicao.body(corpo.clone()).send().await.map_err(|_| {
            format!("Não foi possível conectar ao Xbox para {etapa}. Confira sua conexão.")
        })?;
        let status = resposta.status();
        let headers = resposta.headers().clone();
        let data_remota = data_servidor(&headers);
        let texto = resposta
            .text()
            .await
            .map_err(|_| format!("Não foi possível ler a resposta do Xbox ao {etapa}."))?;
        if !status.is_success() {
            if tentativa == 0 && status == reqwest::StatusCode::FORBIDDEN {
                if let Some(data) = data_remota {
                    if (data - current_date).num_seconds().unsigned_abs() > 30 {
                        current_date = data;
                        continue;
                    }
                }
            }
            eprintln!("[Auth:Xbox] Falha ao {etapa}: HTTP {}", status.as_u16());
            return Err(erro_xbox(status, etapa, &texto));
        }
        let valor = serde_json::from_str::<T>(&texto).map_err(|_| {
            format!(
                "O Xbox retornou uma resposta inválida ao {etapa} (HTTP {}).",
                status.as_u16()
            )
        })?;
        return Ok((
            RequestWithDate {
                date: data_remota.unwrap_or(current_date),
                value: valor,
            },
            headers,
        ));
    }
    unreachable!("a segunda tentativa sempre retorna")
}

// 1. Get Device Token
async fn get_device_token(
    client: &Client,
    key: &DeviceTokenKey,
    data: DateTime<Utc>,
) -> Result<RequestWithDate<DeviceToken>, String> {
    let (res, _) = send_signed_request(
        client,
        "https://device.auth.xboxlive.com/device/authenticate",
        "/device/authenticate",
        json!({
            "Properties": {
                "AuthMethod": "ProofOfPossession",
                "Id": format!("{{{}}}", key.id.to_string().to_uppercase()),
                "DeviceType": "Win32",
                "Version": "10.0.0", // Mimic Windows 10
                "ProofKey": {
                    "kty": "EC",
                    "x": key.x,
                    "y": key.y,
                    "crv": "P-256",
                    "alg": "ES256",
                    "use": "sig"
                }
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }),
        key,
        data,
    )
    .await?;

    Ok(res)
}

// --- Public Commands ---

// --- Imports Adicionais ---
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

// ... (Constants and Structs remain similar, add/keep SisuAuthorizationResponse)

// Structs for Finish Flow
#[derive(Deserialize)]
struct OAuthToken {
    access_token: String,
    #[allow(dead_code)]
    refresh_token: String,
    #[allow(dead_code)]
    expires_in: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SisuAuthorizationResponse {
    authorization_token: SisuToken,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct SisuToken {
    display_claims: HashMap<String, serde_json::Value>,
    token: String,
}

#[derive(Deserialize)]
struct TokenMinecraft {
    access_token: String,
    expires_in: Option<u64>,
}

#[derive(Deserialize)]
struct PerfilMinecraft {
    id: String,
    name: String,
}

fn mensagem_erro_minecraft(corpo: &str, padrao: &str) -> String {
    let Ok(valor) = serde_json::from_str::<serde_json::Value>(corpo) else {
        return padrao.to_string();
    };

    valor
        .get("errorMessage")
        .or_else(|| valor.get("message"))
        .or_else(|| valor.get("error"))
        .and_then(|mensagem| mensagem.as_str())
        .filter(|mensagem| !mensagem.trim().is_empty())
        .unwrap_or(padrao)
        .to_string()
}

fn erro_perfil_minecraft(status: reqwest::StatusCode, corpo: &str) -> String {
    if status == reqwest::StatusCode::NOT_FOUND {
        return "Esta conta Microsoft não possui um perfil do Minecraft Java. Confirme a licença e crie o perfil no site oficial do Minecraft antes de entrar.".to_string();
    }

    let detalhe = mensagem_erro_minecraft(corpo, "resposta inválida do serviço");
    format!(
        "Não foi possível consultar o perfil do Minecraft (HTTP {}). {}",
        status.as_u16(),
        detalhe
    )
}

async fn aguardar_nova_tentativa(tentativa: usize) {
    let atraso = if tentativa == 0 { 500 } else { 1_500 };
    tokio::time::sleep(tokio::time::Duration::from_millis(atraso)).await;
}

async fn obter_token_minecraft(
    client: &Client,
    token_identidade: &str,
) -> Result<TokenMinecraft, String> {
    for tentativa in 0..3 {
        let resposta = client
            .post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .json(&json!({ "identityToken": token_identidade }))
            .send()
            .await;

        let resposta = match resposta {
            Ok(resposta) => resposta,
            Err(erro) if tentativa < 2 && (erro.is_timeout() || erro.is_connect()) => {
                aguardar_nova_tentativa(tentativa).await;
                continue;
            }
            Err(erro) => {
                return Err(format!(
                    "Não foi possível conectar ao serviço do Minecraft: {}",
                    erro
                ))
            }
        };

        let status = resposta.status();
        let corpo = resposta
            .text()
            .await
            .map_err(|erro| format!("Não foi possível ler a resposta do Minecraft: {}", erro))?;

        if status.is_success() {
            return serde_json::from_str::<TokenMinecraft>(&corpo).map_err(|_| {
                "O serviço do Minecraft retornou uma resposta de login inválida.".to_string()
            });
        }

        if tentativa < 2
            && (status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
        {
            aguardar_nova_tentativa(tentativa).await;
            continue;
        }

        let detalhe = mensagem_erro_minecraft(&corpo, "autenticação recusada pelo serviço");
        return Err(format!(
            "Não foi possível autenticar no Minecraft (HTTP {}). {}",
            status.as_u16(),
            detalhe
        ));
    }

    unreachable!("o laço sempre retorna na última tentativa")
}

async fn obter_perfil_minecraft(
    client: &Client,
    access_token: &str,
) -> Result<PerfilMinecraft, String> {
    for tentativa in 0..3 {
        let resposta = client
            .get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(access_token)
            .send()
            .await;

        let resposta = match resposta {
            Ok(resposta) => resposta,
            Err(erro) if tentativa < 2 && (erro.is_timeout() || erro.is_connect()) => {
                aguardar_nova_tentativa(tentativa).await;
                continue;
            }
            Err(erro) => {
                return Err(format!(
                    "Não foi possível conectar ao perfil do Minecraft: {}",
                    erro
                ))
            }
        };

        let status = resposta.status();
        let corpo = resposta
            .text()
            .await
            .map_err(|erro| format!("Não foi possível ler o perfil do Minecraft: {}", erro))?;

        if status.is_success() {
            return serde_json::from_str::<PerfilMinecraft>(&corpo)
                .map_err(|_| "O serviço do Minecraft retornou um perfil inválido.".to_string());
        }

        if tentativa < 2
            && (status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error())
        {
            aguardar_nova_tentativa(tentativa).await;
            continue;
        }

        return Err(erro_perfil_minecraft(status, &corpo));
    }

    unreachable!("o laço sempre retorna na última tentativa")
}

// --- Unified Automated Command ---

#[tauri::command]
pub async fn login_microsoft_sisu(
    app: AppHandle,
    state: State<'_, LauncherState>,
) -> Result<MinecraftAccount, String> {
    // 1. Setup Local Server for Interception
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    // 2. Prepare SISU Request (Start Step)
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let key = generate_key()?;

    let device_req = get_device_token(&client, &key, Utc::now()).await?;
    let device_token = device_req.value.token;

    let verifier = generate_oauth_challenge();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let oauth_state = generate_oauth_challenge();

    let (sisu_res, sisu_headers) = send_signed_request::<RedirectUri>(
        &client,
        "https://sisu.xboxlive.com/authenticate",
        "/authenticate",
        json!({
            "AppId": MICROSOFT_CLIENT_ID,
            "DeviceToken": device_token,
            "Offers": [REQUESTED_SCOPE],
            "Query": {
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": oauth_state,
                "prompt": "select_account"
            },
            "RedirectUri": AUTH_REPLY_URL,
            "Sandbox": "RETAIL",
            "TokenType": "code",
            "TitleId": TITLE_ID
        }),
        &key,
        device_req.date,
    )
    .await?;

    let auth_url = sisu_res.value.msa_oauth_redirect;

    // 3. Open Login Window with Injection
    let window_label = "microsoft-auth-window";

    // Close existing if any
    if let Some(win) = app.get_webview_window(window_label) {
        let _ = win.close();
    }

    // Script to detect success page and redirect to localhost
    let script = format!(
        r#"
        (function() {{
            const check = setInterval(() => {{
                if (window.location.href.includes("code=") || window.location.href.includes("error=")) {{
                    clearInterval(check);
                    // Redirect to our local server to pass the full URL
                    window.location.href = "http://127.0.0.1:{}/callback?final_url=" + encodeURIComponent(window.location.href);
                }}
            }}, 500);
        }})();
    "#,
        port
    );

    let _auth_window = WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::External(auth_url.parse().unwrap()),
    )
    .title("Entrar na Microsoft")
    .inner_size(500.0, 600.0)
    .initialization_script(&script)
    .build()
    .map_err(|e| format!("Failed to create window: {}", e))?;

    // 4. Wait for Callback on Local Server
    let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .await
        .map_err(|e| e.to_string())?;

    // Response 200 OK to browser (and close window logic)
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><script>window.close();</script><h1>Login Recebido (DOME)</h1></body></html>";
    stream.write_all(response.as_bytes()).await.ok();

    // Close window explicitly safely
    if let Some(win) = app.get_webview_window(window_label) {
        let _ = win.close();
    }

    // 5. Extract Code from Request Line
    // GET /callback?final_url=..... HTTP/1.1
    let url_part = request_line
        .split_whitespace()
        .nth(1)
        .ok_or("Invalid Request")?;
    // decode url part is tricky because it is double encoded?
    // Browser: GET /callback?final_url=https%3A%2F%2Flogin...
    // We parse "final_url="

    let final_url_encoded = url_part.split("final_url=").nth(1).ok_or("No final url")?;
    let final_url_decoded = urlencoding::decode(final_url_encoded)
        .map_err(|_| "Decode error")?
        .to_string();

    // Now parse query params from final_url_decoded
    // final_url_decoded should be like: https://login.live.com/oauth20_desktop.srf?code=M.R3...&...

    let url_obj = url::Url::parse(&final_url_decoded).map_err(|_| "Invalid URL")?;
    let query_pairs: HashMap<_, _> = url_obj.query_pairs().into_owned().collect();

    if let Some(error) = query_pairs.get("error") {
        return Err(format!("Microsoft Login Error: {}", error));
    }

    let auth_code = query_pairs
        .get("code")
        .ok_or("No code found in URL")?
        .to_string();

    // 6. Finish Login (same logic as before)

    // Reconstruct Session Data? Setup Key manually since we are in same function scope!
    // No need to save/load from State mutex anymore! We have everything here.

    // Slight delay to ensure SISU Session is ready on server side (Avoid 503/404)
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // Exchange OAuth Code
    let oauth_res_raw = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MICROSOFT_CLIENT_ID),
            ("code", &auth_code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", AUTH_REPLY_URL),
            ("code_verifier", &verifier),
            ("scope", REQUESTED_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data_oauth = data_servidor(oauth_res_raw.headers()).unwrap_or_else(Utc::now);
    let oauth_text = oauth_res_raw.text().await.map_err(|e| e.to_string())?;

    if oauth_text.contains("\"error\"") {
        return Err(format!("Erro OAuth: {}", oauth_text));
    }

    let oauth_res: OAuthToken =
        serde_json::from_str(&oauth_text).map_err(|e| format!("Bad OAuth JSON: {}", e))?;

    // SISU Authorize
    // Need session_id from STEP 2!
    let session_id = sisu_headers
        .get("X-SessionId")
        .or_else(|| sisu_headers.get("x-sessionid"))
        .or_else(|| sisu_headers.get("X-Session-Id"))
        .and_then(|h| h.to_str().ok())
        .ok_or("No Session ID")?
        .to_string();

    let auth_body = json!({
        "AppId": MICROSOFT_CLIENT_ID,
        "DeviceToken": device_token, // From step 2
        "Sandbox": "RETAIL",
        "UseModernGamertag": true,
        "SiteName": "user.auth.xboxlive.com",
        "RelyingParty": "rp://api.minecraftservices.com/",
        "ProofKey": {
             "kty": "EC",
             "x": key.x,
             "y": key.y,
             "crv": "P-256",
             "alg": "ES256",
             "use": "sig"
        },
        "AccessToken": "t=".to_string() + &oauth_res.access_token,
        "SessionId": session_id
    });

    let (authorize_res, _) = send_signed_request::<SisuAuthorizationResponse>(
        &client,
        "https://sisu.xboxlive.com/authorize",
        "/authorize",
        auth_body,
        &key,
        data_oauth,
    )
    .await?;

    let uhs = authorize_res
        .value
        .authorization_token
        .display_claims
        .get("xui")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|obj| obj.get("uhs"))
        .and_then(|s| s.as_str())
        .ok_or("Failed to get UHS")?;

    let token_identidade = format!(
        "XBL3.0 x={};{}",
        uhs, authorize_res.value.authorization_token.token
    );
    let token_minecraft = obter_token_minecraft(&client, &token_identidade).await?;
    let perfil = obter_perfil_minecraft(&client, &token_minecraft.access_token).await?;
    let mc_access_token = token_minecraft.access_token;
    let uuid = perfil.id;
    let name = perfil.name;

    // Calcular expiração do token (padrão do Minecraft é 24 horas)
    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() + token_minecraft.expires_in.unwrap_or(86_400))
        .ok();

    let account = MinecraftAccount {
        id: uuid.clone(),
        uuid,
        name,
        access_token: mc_access_token,
        refresh_token: Some(oauth_res.refresh_token.clone()),
        expires_at,
        token_type: "Bearer".to_string(),
    };

    // Salvar conta no arquivo para persistência
    if let Err(e) = state.save_account(&account) {
        eprintln!("[Auth] Aviso: Erro ao salvar conta: {}", e);
    }

    if let Ok(mut lock) = state.account.lock() {
        *lock = Some(account.clone());
    }

    Ok(account)
}

pub async fn refresh_token_sisu_interno(state: &LauncherState) -> Result<MinecraftAccount, String> {
    let conta_atual = {
        let lock = state
            .account
            .lock()
            .map_err(|_| "Falha ao acessar sessão atual")?;
        lock.clone().ok_or("Nenhuma conta logada")?
    };

    let refresh_token = conta_atual
        .refresh_token
        .clone()
        .ok_or("Sem refresh token disponível - faça login novamente")?;

    println!("[Auth:SISU] Renovando token para: {}", conta_atual.name);

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let key = generate_key()?;
    let device_req = get_device_token(&client, &key, Utc::now()).await?;
    let device_token = device_req.value.token;

    let oauth_res_raw = client
        .post("https://login.live.com/oauth20_token.srf")
        .form(&[
            ("client_id", MICROSOFT_CLIENT_ID),
            ("refresh_token", &refresh_token),
            ("grant_type", "refresh_token"),
            ("redirect_uri", AUTH_REPLY_URL),
            ("scope", REQUESTED_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Erro ao renovar OAuth: {}", e))?;

    let data_oauth = data_servidor(oauth_res_raw.headers()).unwrap_or(device_req.date);
    let oauth_text = oauth_res_raw
        .text()
        .await
        .map_err(|e| format!("Erro ao ler resposta OAuth: {}", e))?;

    if oauth_text.contains("\"error\"") {
        return Err(format!(
            "Falha ao renovar sessão Microsoft: {} - Faça login novamente",
            oauth_text
        ));
    }

    let oauth_res: OAuthToken = serde_json::from_str(&oauth_text)
        .map_err(|e| format!("Resposta OAuth inválida: {} - Body: {}", e, oauth_text))?;

    let auth_body = json!({
        "AppId": MICROSOFT_CLIENT_ID,
        "DeviceToken": device_token,
        "Sandbox": "RETAIL",
        "UseModernGamertag": true,
        "SiteName": "user.auth.xboxlive.com",
        "RelyingParty": "rp://api.minecraftservices.com/",
        "ProofKey": {
             "kty": "EC",
             "x": key.x,
             "y": key.y,
             "crv": "P-256",
             "alg": "ES256",
             "use": "sig"
        },
        "AccessToken": "t=".to_string() + &oauth_res.access_token
    });

    let (authorize_res, _) = send_signed_request::<SisuAuthorizationResponse>(
        &client,
        "https://sisu.xboxlive.com/authorize",
        "/authorize",
        auth_body,
        &key,
        data_oauth,
    )
    .await?;

    let uhs = authorize_res
        .value
        .authorization_token
        .display_claims
        .get("xui")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|obj| obj.get("uhs"))
        .and_then(|s| s.as_str())
        .ok_or("Falha ao obter UHS")?;

    let token_identidade = format!(
        "XBL3.0 x={};{}",
        uhs, authorize_res.value.authorization_token.token
    );
    let token_minecraft = obter_token_minecraft(&client, &token_identidade).await?;
    let perfil = obter_perfil_minecraft(&client, &token_minecraft.access_token).await?;
    let mc_access_token = token_minecraft.access_token;
    let uuid = perfil.id;
    let name = perfil.name;

    let expires_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() + oauth_res.expires_in)
        .ok();

    let conta_atualizada = MinecraftAccount {
        id: uuid.clone(),
        uuid,
        name,
        access_token: mc_access_token,
        refresh_token: Some(oauth_res.refresh_token),
        expires_at,
        token_type: "Bearer".to_string(),
    };

    if let Err(e) = state.save_account(&conta_atualizada) {
        eprintln!("[Auth:SISU] Aviso ao salvar conta renovada: {}", e);
    }

    if let Ok(mut lock) = state.account.lock() {
        *lock = Some(conta_atualizada.clone());
    }

    println!("[Auth:SISU] Token renovado com sucesso.");
    Ok(conta_atualizada)
}

#[cfg(test)]
mod tests {
    use super::{erro_perfil_minecraft, mensagem_erro_minecraft};
    use reqwest::StatusCode;

    async fn simular_xbox(
        status: &[&str],
        data: chrono::DateTime<chrono::Utc>,
    ) -> (String, tokio::task::JoinHandle<Vec<Vec<u8>>>) {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let respostas: Vec<_> = status.iter().map(|status| {
            let corpo = if status.starts_with("403") { "" } else { "{}" };
            format!("HTTP/1.1 {status}\r\nDate: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{corpo}", data.to_rfc2822(), corpo.len())
        }).collect();
        let tarefa = tokio::spawn(async move {
            let mut capturas = Vec::new();
            for resposta in respostas {
                let (conexao, _) = listener.accept().await.unwrap();
                let mut leitor = BufReader::new(conexao);
                let mut assinatura = String::new();
                let mut tamanho = 0;
                loop {
                    let mut linha = String::new();
                    leitor.read_line(&mut linha).await.unwrap();
                    if linha == "\r\n" {
                        break;
                    }
                    if let Some((nome, valor)) = linha.split_once(':') {
                        if nome.eq_ignore_ascii_case("signature") {
                            assinatura = valor.trim().to_string();
                        }
                        if nome.eq_ignore_ascii_case("content-length") {
                            tamanho = valor.trim().parse().unwrap();
                        }
                    }
                }
                let mut corpo = vec![0; tamanho];
                leitor.read_exact(&mut corpo).await.unwrap();
                use base64::Engine;
                let assinatura = super::STANDARD.decode(assinatura).unwrap();
                capturas.push([assinatura, corpo].concat());
                leitor
                    .get_mut()
                    .write_all(resposta.as_bytes())
                    .await
                    .unwrap();
            }
            capturas
        });
        (url, tarefa)
    }

    #[tokio::test]
    async fn corrige_relogio_e_assina_os_bytes_enviados_apos_403_vazio() {
        use p256::ecdsa::signature::Verifier;
        let data = chrono::Utc::now();
        let (url, servidor) = simular_xbox(&["403 Forbidden", "200 OK"], data).await;
        let chave = super::generate_key().unwrap();
        let corpo = serde_json::json!({"teste": "ação", "numero": 1});
        let (resposta, _) = super::send_signed_request::<serde_json::Value>(
            &reqwest::Client::new(),
            &url,
            "/authorize",
            corpo.clone(),
            &chave,
            data - chrono::Duration::hours(2),
        )
        .await
        .unwrap();
        assert_eq!(resposta.date.timestamp(), data.timestamp());
        let capturas = servidor.await.unwrap();
        assert_eq!(capturas.len(), 2);
        for (indice, captura) in capturas.iter().enumerate() {
            let assinatura = &captura[..76];
            let bytes = &captura[76..];
            assert_eq!(bytes, serde_json::to_vec(&corpo).unwrap());
            let filetime = u64::from_be_bytes(assinatura[4..12].try_into().unwrap());
            let esperado = data - chrono::Duration::hours(if indice == 0 { 2 } else { 0 });
            assert_eq!(
                filetime / 10_000_000 - 11_644_473_600,
                esperado.timestamp() as u64
            );
            let mut mensagem = Vec::new();
            for parte in [
                &assinatura[..4],
                &assinatura[4..12],
                b"POST",
                b"/authorize",
                b"",
                bytes,
            ] {
                mensagem.extend_from_slice(parte);
                mensagem.push(0);
            }
            chave
                .key
                .verifying_key()
                .verify(
                    &mensagem,
                    &p256::ecdsa::Signature::from_slice(&assinatura[12..]).unwrap(),
                )
                .unwrap();
        }
    }

    #[tokio::test]
    async fn nao_repete_403_com_relogio_correto_e_limita_correcao_a_uma_tentativa() {
        for atraso in [0, 7200] {
            let data = chrono::Utc::now();
            let status = if atraso == 0 {
                vec!["403 Forbidden"]
            } else {
                vec!["403 Forbidden", "403 Forbidden"]
            };
            let (url, servidor) = simular_xbox(&status, data).await;
            let erro = super::send_signed_request::<serde_json::Value>(
                &reqwest::Client::new(),
                &url,
                "/authenticate",
                serde_json::json!({}),
                &super::generate_key().unwrap(),
                data - chrono::Duration::seconds(atraso),
            )
            .await
            .err()
            .unwrap();
            assert!(erro.contains("iniciar o login Microsoft (HTTP 403)"));
            assert_eq!(servidor.await.unwrap().len(), status.len());
        }
    }

    #[test]
    fn erro_xbox_preserva_codigo_sem_expor_corpo_remoto() {
        let erro = super::erro_xbox(
            StatusCode::FORBIDDEN,
            "autorizar a conta Microsoft",
            r#"{"XErr":2148916233,"Token":"segredo"}"#,
        );
        assert!(erro.contains("2148916233"));
        assert!(erro.contains("crie seu perfil Xbox"));
        assert!(!erro.contains("segredo"));
        assert!(
            super::erro_xbox(StatusCode::FORBIDDEN, "autenticar o dispositivo", "")
                .contains("HTTP 403")
        );
    }

    #[tokio::test]
    #[ignore = "contata o Xbox real, sem credenciais de usuário"]
    async fn autentica_dispositivo_no_xbox_com_relogio_adiantado() {
        let cliente = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        let chave = super::generate_key().unwrap();
        let resposta = super::get_device_token(
            &cliente,
            &chave,
            chrono::Utc::now() + chrono::Duration::hours(2),
        )
        .await
        .unwrap();
        assert!(!resposta.value.token.is_empty());
        assert!(
            (resposta.date - chrono::Utc::now())
                .num_seconds()
                .unsigned_abs()
                < 60
        );
    }

    #[test]
    fn extrai_mensagem_da_resposta_do_minecraft() {
        let corpo = r#"{"error":"TooManyRequests","errorMessage":"Tente novamente mais tarde"}"#;

        assert_eq!(
            mensagem_erro_minecraft(corpo, "erro padrão"),
            "Tente novamente mais tarde"
        );
    }

    #[test]
    fn explica_quando_a_conta_nao_possui_perfil_java() {
        let mensagem = erro_perfil_minecraft(StatusCode::NOT_FOUND, "{}");

        assert!(mensagem.contains("não possui um perfil do Minecraft Java"));
        assert!(mensagem.contains("crie o perfil no site oficial"));
    }

    #[test]
    fn preserva_status_em_falha_do_servico_de_perfil() {
        let mensagem = erro_perfil_minecraft(
            StatusCode::SERVICE_UNAVAILABLE,
            r#"{"errorMessage":"Serviço temporariamente indisponível"}"#,
        );

        assert!(mensagem.contains("HTTP 503"));
        assert!(mensagem.contains("Serviço temporariamente indisponível"));
    }
}
