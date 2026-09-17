use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NovidadeLauncher {
    pub id: String,
    pub titulo: String,
    pub resumo: String,
    pub conteudo: String,
    pub imagem_url: String,
    pub categoria: String,
    pub versao: String,
    pub publicado_em: String,
}

#[derive(Debug, Deserialize)]
struct RespostaNovidadesLauncher {
    novidades: Vec<NovidadeLauncher>,
}

#[tauri::command]
pub async fn get_launcher_news(
    api_base_url: String,
    limite: Option<u8>,
) -> Result<Vec<NovidadeLauncher>, String> {
    let base = normalizar_api_base_url(&api_base_url)?;
    let limite = limite.unwrap_or(8).clamp(1, 30);
    let resposta = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| "Não foi possível preparar o cliente de novidades.".to_string())?
        .get(format!("{base}/api/launcher/novidades"))
        .query(&[("limite", limite)])
        .send()
        .await
        .map_err(|_| "Não foi possível conectar ao serviço de novidades.".to_string())?;

    if !resposta.status().is_success() {
        return Err("O serviço de novidades está indisponível.".to_string());
    }

    resposta
        .json::<RespostaNovidadesLauncher>()
        .await
        .map(|corpo| corpo.novidades)
        .map_err(|_| "O serviço de novidades retornou dados inválidos.".to_string())
}

fn normalizar_api_base_url(valor: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(valor.trim())
        .map_err(|_| "A URL do serviço de novidades é inválida.".to_string())?;
    let host = url.host_str().unwrap_or_default();
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("O serviço de novidades exige HTTPS.".to_string());
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("A URL do serviço de novidades é inválida.".to_string());
    }

    Ok(valor.trim().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod testes {
    use super::normalizar_api_base_url;

    #[test]
    fn aceita_https_e_http_local() {
        assert_eq!(
            normalizar_api_base_url("https://api.domestudios.com.br/").unwrap(),
            "https://api.domestudios.com.br"
        );
        assert!(normalizar_api_base_url("http://localhost:3000").is_ok());
    }

    #[test]
    fn rejeita_http_remoto_e_url_com_credenciais() {
        assert!(normalizar_api_base_url("http://api.domestudios.com.br").is_err());
        assert!(normalizar_api_base_url("https://usuario@api.domestudios.com.br").is_err());
    }
}
