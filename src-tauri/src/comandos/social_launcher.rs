#[path = "operacoes_sociais.rs"]
pub(crate) mod operacoes_sociais;
#[path = "pacotes_sociais.rs"]
pub(crate) mod pacotes_sociais;
#[path = "vinculos_sociais.rs"]
pub(crate) mod vinculos_sociais;
use crate::launcher::LauncherState;
use base64::Engine;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::AsyncWriteExt;

#[tauri::command]
pub fn descartar_pacote_social(caminho_arquivo: String) -> Result<(), String> {
    let caminho = std::path::PathBuf::from(caminho_arquivo)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let raiz = std::env::temp_dir()
        .join("dome-social-sync")
        .join("outgoing")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !caminho.starts_with(raiz) {
        return Err("Pacote fora da pasta de envio.".into());
    }
    std::fs::remove_file(caminho).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn obter_previa_pacote_social(
    instance_id: String,
    state: State<'_, LauncherState>,
) -> Result<pacotes_sociais::PreviaSocial, String> {
    let instancia =
        crate::comandos::instancia_sistema::obter_instancia_por_id(&state, &instance_id)?;
    tauri::async_runtime::spawn_blocking(move || pacotes_sociais::previa_rapida(&instancia))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gerenciar_transferencias_sociais(
    api_base_url: String,
    access_token: String,
    acao: String,
    pedido_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let cliente = criar_cliente_http_launcher()?;
    let endpoint = format!("{base}/api/launcher/social/sync");
    let requisicao = if acao == "listar" {
        cliente.get(endpoint)
    } else if matches!(acao.as_str(), "confirmar" | "cancelar") {
        let id = pedido_id
            .filter(|id| !id.is_empty())
            .ok_or("Pedido ausente.")?;
        cliente.post(format!("{endpoint}/{}/{acao}", urlencoding::encode(&id)))
    } else {
        return Err("Ação inválida.".into());
    };
    let resposta = requisicao
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Não foi possível conectar ao serviço de transferências.".to_string())?;
    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao atualizar transferência.").await,
        );
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn gerenciar_compartilhamentos_sociais(
    api_base_url: String,
    access_token: String,
    acao: String,
    dados: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if ![
        "listar", "criar", "aceitar", "receber", "publicar", "convidar", "revogar", "remover",
        "sair", "encerrar",
    ]
    .contains(&acao.as_str())
    {
        return Err("Ação inválida.".into());
    }
    let base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let resposta = criar_cliente_http_launcher()?
        .post(format!(
            "{base}/api/launcher/social/compartilhamentos/{acao}"
        ))
        .bearer_auth(token)
        .json(&dados)
        .send()
        .await
        .map_err(|_| "Falha ao conectar ao serviço de compartilhamento.".to_string())?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha no compartilhamento.").await);
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AtividadeSocialLauncherApi {
    pub tipo: String,
    pub instancia_id: Option<String>,
    pub instancia_nome: Option<String>,
    pub servidor: Option<String>,
    pub source: Option<String>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_id: Option<String>,
    pub modpack_nome: Option<String>,
    pub icone_url: Option<String>,
    pub versao_minecraft: Option<String>,
    pub loader: Option<String>,
    pub atualizado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AmigoLauncherApi {
    pub amizade_id: String,
    pub friend_profile_id: String,
    pub nome: String,
    pub handle: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub online: bool,
    pub status: Option<String>,
    pub atividade_atual: Option<AtividadeSocialLauncherApi>,
    pub ultimo_seen_em: Option<String>,
    #[serde(default)]
    pub emblema_destaque: Option<EmblemaSocialLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolicitacaoRecebidaAmizadeApi {
    pub id: String,
    pub de_perfil_id: String,
    pub de_handle: Option<String>,
    pub de_nome: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SolicitacaoEnviadaAmizadeApi {
    pub id: String,
    pub para_perfil_id: String,
    pub para_handle: Option<String>,
    pub para_nome: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaAmigosLauncherApi {
    #[serde(default)]
    pub amigos: Vec<AmigoLauncherApi>,
    #[serde(default)]
    pub pendentes_recebidas: Vec<SolicitacaoRecebidaAmizadeApi>,
    #[serde(default)]
    pub pendentes_enviadas: Vec<SolicitacaoEnviadaAmizadeApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContaMinecraftSocialLauncherApi {
    pub uuid: String,
    pub nome: String,
    pub vinculado_em: String,
    pub ultimo_uso_em: Option<String>,
}

#[tauri::command]
pub async fn exchange_launcher_minecraft_session(
    api_base_url: String,
    minecraft_access_token: String,
) -> Result<serde_json::Value, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = minecraft_access_token.trim();
    if token.is_empty() {
        return Err("Token Minecraft ausente.".to_string());
    }

    let resposta = criar_cliente_http_launcher()?
        .post(format!("{api_base}/api/launcher/auth/minecraft/exchange"))
        .json(&serde_json::json!({ "minecraftAccessToken": token }))
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao iniciar sessão Dome: {e}"))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Não foi possível iniciar a sessão Dome pelo Minecraft.",
        )
        .await);
    }

    resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida ao iniciar sessão Dome: {e}"))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmblemaSocialLauncherApi {
    pub emblema_id: String,
    pub nome: String,
    pub descricao: String,
    pub imagem_url: String,
    pub concedido_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CapturaFavoritaPerfilLauncherApi {
    pub id: String,
    pub nome: String,
    pub instancia_nome: String,
    pub criada_em: Option<String>,
    pub imagem_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ComentarioPerfilLauncherApi {
    pub id: String,
    pub conteudo: String,
    pub criado_em: String,
    pub autor_perfil_id: String,
    pub autor_nome: String,
    pub autor_avatar_url: Option<String>,
    #[serde(default)]
    pub emblema_destaque: Option<EmblemaSocialLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfilSocialLauncherApi {
    pub perfil_id: String,
    pub discord_id: String,
    pub discord_username: String,
    pub discord_global_name: Option<String>,
    pub discord_avatar: Option<String>,
    pub handle: String,
    pub nome_social: String,
    #[serde(default)]
    pub contas_minecraft_vinculadas: Vec<ContaMinecraftSocialLauncherApi>,
    pub conta_minecraft_principal_uuid: Option<String>,
    pub online: bool,
    pub status: Option<String>,
    pub aparecer_offline: Option<bool>,
    pub em_jogo: Option<bool>,
    pub atividade_atual: Option<AtividadeSocialLauncherApi>,
    pub ultimo_seen_em: Option<String>,
    #[serde(default)]
    pub emblemas: Vec<EmblemaSocialLauncherApi>,
    #[serde(default)]
    pub emblemas_exibidos: Vec<EmblemaSocialLauncherApi>,
    pub banner_perfil_url: Option<String>,
    #[serde(default)]
    pub capturas_favoritas: Vec<CapturaFavoritaPerfilLauncherApi>,
    #[serde(default)]
    pub bio: String,
    #[serde(default)]
    pub instancias_recentes: Vec<InstanciaPublicaPerfilLauncherApi>,
    #[serde(default)]
    pub instancias_favoritas: Vec<InstanciaPublicaPerfilLauncherApi>,
    #[serde(default)]
    pub amigos: Vec<AmigoLauncherApi>,
    pub criado_em: String,
    pub atualizado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstanciaPublicaPerfilLauncherApi {
    pub id: String,
    pub nome: String,
    pub versao: String,
    pub carregador: String,
    pub icone_url: Option<String>,
    pub horas_jogadas: f64,
    pub ultima_vez: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadSalvarPerfilSocialLauncherApi {
    pub nome_social: Option<String>,
    pub handle: Option<String>,
    pub conta_minecraft_principal_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instancias_recentes: Option<Vec<InstanciaPublicaPerfilLauncherApi>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instancias_favoritas: Option<Vec<InstanciaPublicaPerfilLauncherApi>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaSalvarPerfilSocialLauncherApi {
    pub sucesso: Option<bool>,
    pub perfil: Option<PerfilSocialLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadSolicitarAmizadeHandleLauncherApi {
    pub handle: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerfilBuscaAmizadeLauncherApi {
    pub perfil_id: String,
    pub nome: String,
    pub handle: String,
    pub avatar_url: Option<String>,
    pub online: bool,
    pub status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaSolicitacaoAmizadeLauncherApi {
    pub sucesso: bool,
    pub id: String,
    pub destinatario_perfil_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MensagemChatLauncherApi {
    pub id: String,
    pub de_perfil_id: String,
    pub para_perfil_id: String,
    pub conteudo: String,
    pub criado_em: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaMensagensChatLauncherApi {
    pub conversa_id: String,
    #[serde(default)]
    pub mensagens: Vec<MensagemChatLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadEnviarMensagemChatLauncherApi {
    pub para_perfil_id: String,
    pub conteudo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadVincularMinecraftSocialLauncherApi {
    pub uuid: String,
    pub nome: String,
    pub minecraft_access_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadStatusSocialLauncherApi {
    pub status_manual: Option<String>,
    pub aparecer_offline: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RespostaStatusSocialLauncherApi {
    pub sucesso: Option<bool>,
    pub perfil: Option<PerfilSocialLauncherApi>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoExportacaoSyncSocial {
    pub caminho_arquivo: String,
    pub tamanho_bytes: u64,
    pub previa: pacotes_sociais::PreviaSocial,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PayloadUploadSyncSocial {
    pub pedido_id: String,
    pub token_upload: String,
    pub caminho_arquivo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoDownloadImportacaoSyncSocial {
    pub pedido_id: String,
    pub caminho_arquivo: String,
    pub instancia_id: Option<String>,
    pub mensagem: String,
}

fn normalizar_api_base_url(api_base_url: &str) -> Result<String, String> {
    let url = url::Url::parse(api_base_url.trim())
        .map_err(|_| "URL da API do launcher inválida.".to_string())?;
    let host = url.host_str().unwrap_or_default();
    let desenvolvimento_local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url.scheme() != "https" && !(url.scheme() == "http" && desenvolvimento_local) {
        return Err("A API do launcher deve usar HTTPS.".to_string());
    }

    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn criar_cliente_http_launcher() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP do launcher: {}", e))
}

// Cliente sem timeout fixo para transfersências grandes (upload/download de instâncias)
fn criar_cliente_http_transferencia() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP de transferência: {}", e))
}

pub async fn extrair_mensagem_erro_launcher(resposta: reqwest::Response, contexto: &str) -> String {
    let status = resposta.status();
    let corpo = resposta.text().await.unwrap_or_default();
    if corpo.is_empty() {
        return format!("{} (HTTP {})", contexto, status.as_u16());
    }

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&corpo) {
        let mensagem = json
            .get("erro")
            .and_then(|erro| erro.get("mensagem"))
            .and_then(|valor| valor.as_str())
            .or_else(|| json.get("message").and_then(|valor| valor.as_str()))
            .or_else(|| json.get("erro").and_then(|valor| valor.as_str()))
            .or_else(|| json.get("error").and_then(|valor| valor.as_str()));

        if let Some(mensagem) = mensagem {
            return format!("{} (HTTP {}): {}", contexto, status.as_u16(), mensagem);
        }
    }

    let trecho: String = corpo.chars().take(200).collect();
    format!("{} (HTTP {}): {}", contexto, status.as_u16(), trecho)
}

#[tauri::command]
pub async fn get_launcher_friends(
    api_base_url: String,
    access_token: String,
) -> Result<RespostaAmigosLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/friends", api_base);

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar amigos: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao buscar amigos.").await);
    }

    resposta
        .json::<RespostaAmigosLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida da API de amigos: {}", e))
}

#[tauri::command]
pub async fn search_launcher_friend_by_handle(
    api_base_url: String,
    access_token: String,
    handle: String,
) -> Result<Option<PerfilBuscaAmizadeLauncherApi>, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let handle = handle.trim().trim_start_matches('@').to_lowercase();
    if handle.len() < 3 || handle.len() > 24 {
        return Ok(None);
    }

    let endpoint = format!(
        "{}/api/launcher/friends/search-by-handle/{}",
        api_base,
        urlencoding::encode(&handle)
    );
    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar perfil: {}", e))?;

    if resposta.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao buscar perfil.").await);
    }

    resposta
        .json::<PerfilBuscaAmizadeLauncherApi>()
        .await
        .map(Some)
        .map_err(|e| format!("Resposta inválida da busca de perfil: {}", e))
}

#[tauri::command]
pub async fn get_launcher_social_profile(
    api_base_url: String,
    access_token: String,
    perfil_id: Option<String>,
) -> Result<PerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let destino = perfil_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| "me".into());
    let endpoint = format!(
        "{}/api/launcher/social/profile/{}",
        api_base,
        urlencoding::encode(&destino)
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar perfil social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao carregar perfil social.").await,
        );
    }

    let dados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida da API de perfil social: {}", e))?;

    serde_json::from_value::<PerfilSocialLauncherApi>(
        dados
            .get("perfil")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .map_err(|e| format!("Resposta sem perfil social válido: {}", e))
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturaApresentacaoLauncherApi {
    pub id: String,
    pub nome: String,
    pub instancia_nome: String,
    pub criada_em: Option<String>,
    pub dados_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApresentacaoPerfilLauncherApi {
    pub banner_dados_url: Option<String>,
    pub capturas: Vec<CapturaApresentacaoLauncherApi>,
    pub emblemas_exibidos_ids: Vec<String>,
    pub bio: String,
    pub instancias_recentes: Vec<InstanciaPublicaPerfilLauncherApi>,
    pub instancias_favoritas: Vec<InstanciaPublicaPerfilLauncherApi>,
}

fn decodificar_imagem_dados(dados_url: &str) -> Result<(String, Vec<u8>), String> {
    let (cabecalho, conteudo) = dados_url.split_once(',').ok_or("Imagem inválida.")?;
    let tipo = cabecalho
        .strip_prefix("data:")
        .and_then(|valor| valor.split(';').next())
        .filter(|valor| matches!(*valor, "image/png" | "image/jpeg" | "image/webp"))
        .ok_or("Formato de imagem não suportado.")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(conteudo)
        .map_err(|_| "Não foi possível ler a imagem.".to_string())?;
    Ok((tipo.to_string(), bytes))
}

async fn enviar_midia_perfil(
    cliente: &reqwest::Client,
    api_base: &str,
    token: &str,
    dados_url: &str,
) -> Result<String, String> {
    if dados_url.starts_with("http://") || dados_url.starts_with("https://") {
        return Ok(dados_url.to_string());
    }
    let (tipo, bytes) = decodificar_imagem_dados(dados_url)?;
    let resposta = cliente
        .post(format!("{api_base}/api/launcher/social/profile/me/media"))
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, tipo)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Erro ao enviar mídia do perfil: {e}"))?;
    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao enviar mídia do perfil.").await,
        );
    }
    let dados: serde_json::Value = resposta.json().await.map_err(|e| e.to_string())?;
    dados
        .get("imagemUrl")
        .and_then(|valor| valor.as_str())
        .map(str::to_string)
        .ok_or("A API não retornou a URL da mídia.".into())
}

async fn publicar_icones_instancias(
    cliente: &reqwest::Client,
    api_base: &str,
    token: &str,
    instancias: &mut [InstanciaPublicaPerfilLauncherApi],
) -> Result<(), String> {
    for instancia in instancias {
        let Some(icone) = instancia.icone_url.as_deref() else {
            continue;
        };
        if !icone.starts_with("data:") {
            continue;
        }
        instancia.icone_url = Some(enviar_midia_perfil(cliente, api_base, token, icone).await?);
    }
    Ok(())
}

#[tauri::command]
pub async fn save_launcher_profile_presentation(
    api_base_url: String,
    access_token: String,
    apresentacao: ApresentacaoPerfilLauncherApi,
) -> Result<PerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let cliente = criar_cliente_http_launcher()?;
    let mut instancias_recentes = apresentacao.instancias_recentes;
    let mut instancias_favoritas = apresentacao.instancias_favoritas;
    publicar_icones_instancias(&cliente, &api_base, &token, &mut instancias_recentes).await?;
    publicar_icones_instancias(&cliente, &api_base, &token, &mut instancias_favoritas).await?;
    let banner_perfil_url = match apresentacao
        .banner_dados_url
        .filter(|valor| !valor.is_empty())
    {
        Some(valor) => Some(enviar_midia_perfil(&cliente, &api_base, &token, &valor).await?),
        None => None,
    };
    let mut capturas_favoritas = Vec::new();
    for captura in apresentacao.capturas.into_iter().take(3) {
        let imagem_url =
            enviar_midia_perfil(&cliente, &api_base, &token, &captura.dados_url).await?;
        capturas_favoritas.push(serde_json::json!({
            "id": captura.id, "nome": captura.nome, "instanciaNome": captura.instancia_nome,
            "criadaEm": captura.criada_em, "imagemUrl": imagem_url
        }));
    }
    let resposta = cliente
        .put(format!(
            "{api_base}/api/launcher/social/profile/me/presentation"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "bannerPerfilUrl": banner_perfil_url,
            "capturasFavoritas": capturas_favoritas,
            "emblemasExibidosIds": apresentacao.emblemas_exibidos_ids,
            "bio": apresentacao.bio,
            "instanciasRecentes": instancias_recentes,
            "instanciasFavoritas": instancias_favoritas
        }))
        .send()
        .await
        .map_err(|e| format!("Erro ao salvar apresentação do perfil: {e}"))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao salvar apresentação do perfil.",
        )
        .await);
    }
    let dados: serde_json::Value = resposta.json().await.map_err(|e| e.to_string())?;
    serde_json::from_value(dados.get("perfil").cloned().unwrap_or_default())
        .map_err(|e| format!("Resposta inválida ao salvar perfil: {e}"))
}

#[tauri::command]
pub async fn get_launcher_profile_comments(
    api_base_url: String,
    access_token: String,
    perfil_id: Option<String>,
) -> Result<Vec<ComentarioPerfilLauncherApi>, String> {
    let destino = perfil_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| "me".into());
    let endpoint = format!(
        "{}/api/launcher/social/profile/{}/comments",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(&destino)
    );
    let resposta = criar_cliente_http_launcher()?
        .get(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao carregar comentários: {}", e))?;
    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao carregar comentários.").await,
        );
    }
    let dados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida de comentários: {}", e))?;
    serde_json::from_value(dados.get("comentarios").cloned().unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn post_launcher_profile_comment(
    api_base_url: String,
    access_token: String,
    conteudo: String,
    perfil_id: Option<String>,
) -> Result<ComentarioPerfilLauncherApi, String> {
    let destino = perfil_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| "me".into());
    let endpoint = format!(
        "{}/api/launcher/social/profile/{}/comments",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(&destino)
    );
    let resposta = criar_cliente_http_launcher()?
        .post(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .json(&serde_json::json!({ "conteudo": conteudo }))
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao comentar: {}", e))?;
    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao publicar comentário.").await,
        );
    }
    resposta
        .json()
        .await
        .map_err(|e| format!("Resposta inválida ao comentar: {}", e))
}

#[tauri::command]
pub async fn delete_launcher_profile_comment(
    api_base_url: String,
    access_token: String,
    comentario_id: String,
) -> Result<(), String> {
    let endpoint = format!(
        "{}/api/launcher/social/profile/me/comments/{}",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(&comentario_id)
    );
    let resposta = criar_cliente_http_launcher()?
        .delete(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao excluir comentário: {}", e))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao excluir comentário.").await);
    }
    Ok(())
}

#[tauri::command]
pub async fn save_launcher_social_profile(
    api_base_url: String,
    access_token: String,
    mut payload: PayloadSalvarPerfilSocialLauncherApi,
) -> Result<RespostaSalvarPerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/social/profile/me", api_base);
    let client = criar_cliente_http_launcher()?;
    if let Some(instancias) = payload.instancias_recentes.as_mut() {
        publicar_icones_instancias(&client, &api_base, &token, instancias).await?;
    }
    if let Some(instancias) = payload.instancias_favoritas.as_mut() {
        publicar_icones_instancias(&client, &api_base, &token, instancias).await?;
    }

    let resposta = client
        .patch(&endpoint)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao salvar perfil social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao salvar perfil social.").await,
        );
    }

    resposta
        .json::<RespostaSalvarPerfilSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida da API ao salvar perfil social: {}", e))
}

#[tauri::command]
pub async fn set_launcher_social_status(
    api_base_url: String,
    access_token: String,
    payload: PayloadStatusSocialLauncherApi,
) -> Result<RespostaStatusSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/social/status/me", api_base);

    let status_manual = payload
        .status_manual
        .as_deref()
        .map(|valor| valor.trim().to_lowercase())
        .filter(|valor| !valor.is_empty());
    if let Some(ref status) = status_manual {
        if status != "online" && status != "ausente" {
            return Err("statusManual invalido. Use online ou ausente.".to_string());
        }
    }

    let corpo = serde_json::json!({
        "statusManual": status_manual,
        "aparecerOffline": payload.aparecer_offline.unwrap_or(false),
    });

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .patch(&endpoint)
        .bearer_auth(token)
        .json(&corpo)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao atualizar status social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao atualizar status social.").await,
        );
    }

    resposta
        .json::<RespostaStatusSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta invalida da API ao atualizar status social: {}", e))
}

#[tauri::command]
pub async fn send_launcher_friend_request_by_handle(
    api_base_url: String,
    access_token: String,
    payload: PayloadSolicitarAmizadeHandleLauncherApi,
) -> Result<RespostaSolicitacaoAmizadeLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    if payload.handle.trim().is_empty() {
        return Err("Handle inválido para solicitação de amizade.".to_string());
    }

    let endpoint = format!("{}/api/launcher/friends/request-by-handle", api_base);
    let client = criar_cliente_http_launcher()?;
    let corpo = PayloadSolicitarAmizadeHandleLauncherApi {
        handle: payload.handle.trim().to_string(),
    };

    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .json(&corpo)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao enviar solicitação de amizade: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Não foi possível enviar solicitação de amizade.",
        )
        .await);
    }

    resposta
        .json::<RespostaSolicitacaoAmizadeLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida ao enviar solicitação de amizade: {}", e))
}

#[tauri::command]
pub async fn cancel_launcher_friend_request(
    api_base_url: String,
    access_token: String,
    request_id: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("ID da solicitacao invalido.".to_string());
    }

    let endpoint = format!(
        "{}/api/launcher/friends/request/{}",
        api_base,
        urlencoding::encode(&request_id)
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .delete(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao cancelar solicitacao: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Nao foi possivel cancelar solicitacao.",
        )
        .await);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_launcher_chat_messages(
    api_base_url: String,
    access_token: String,
    friend_profile_id: String,
    limite: Option<u32>,
) -> Result<RespostaMensagensChatLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let friend_profile_id = friend_profile_id.trim().to_string();
    if friend_profile_id.is_empty() {
        return Err("friendProfileId inválido para buscar mensagens do chat.".to_string());
    }

    let limite_ajustado = limite.unwrap_or(60).clamp(1, 120);
    let endpoint = format!(
        "{}/api/launcher/chat/{}?limite={}",
        api_base,
        urlencoding::encode(&friend_profile_id),
        limite_ajustado
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .get(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao buscar mensagens do chat: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao carregar conversa do chat.",
        )
        .await);
    }

    resposta
        .json::<RespostaMensagensChatLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida da API de chat: {}", e))
}

#[tauri::command]
pub async fn send_launcher_chat_message(
    api_base_url: String,
    access_token: String,
    payload: PayloadEnviarMensagemChatLauncherApi,
) -> Result<MensagemChatLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;

    let para_perfil_id = payload.para_perfil_id.trim().to_string();
    if para_perfil_id.is_empty() {
        return Err("Perfil do destinatario inválido para envio da mensagem.".to_string());
    }

    let conteudo = payload.conteudo.trim().to_string();
    if conteudo.is_empty() {
        return Err("Mensagem vazia.".to_string());
    }

    if conteudo.chars().count() > 500 {
        return Err("Mensagem excede 500 caracteres.".to_string());
    }

    let endpoint = format!("{}/api/launcher/chat/send", api_base);
    let client = criar_cliente_http_launcher()?;
    let corpo = PayloadEnviarMensagemChatLauncherApi {
        para_perfil_id,
        conteudo,
    };

    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .json(&corpo)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao enviar mensagem do chat: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao enviar mensagem do chat.").await,
        );
    }

    let dados = resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida da API ao enviar mensagem: {}", e))?;

    serde_json::from_value::<MensagemChatLauncherApi>(
        dados
            .get("mensagem")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .map_err(|e| format!("Resposta sem mensagem válida no chat: {}", e))
}

#[tauri::command]
pub async fn respond_launcher_friend_request(
    api_base_url: String,
    access_token: String,
    request_id: String,
    acao: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("ID da solicitacao invalido.".to_string());
    }

    let acao_normalizada = acao.trim().to_lowercase();
    let endpoint = match acao_normalizada.as_str() {
        "accept" | "aceitar" => format!(
            "{}/api/launcher/friends/request/{}/accept",
            api_base,
            urlencoding::encode(&request_id)
        ),
        "reject" | "recusar" => format!(
            "{}/api/launcher/friends/request/{}/reject",
            api_base,
            urlencoding::encode(&request_id)
        ),
        _ => return Err("Ação inválida. Use accept/reject.".to_string()),
    };

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao responder solicitacao: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Nao foi possivel responder solicitacao.",
        )
        .await);
    }

    Ok(())
}

#[tauri::command]
pub async fn remove_launcher_friend(
    api_base_url: String,
    access_token: String,
    friend_profile_id: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let friend_profile_id = friend_profile_id.trim().to_string();
    if friend_profile_id.is_empty() {
        return Err("friendProfileId inválido.".to_string());
    }

    let endpoint = format!(
        "{}/api/launcher/friends/{}",
        api_base,
        urlencoding::encode(&friend_profile_id)
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .delete(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao remover amizade: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Nao foi possivel remover amizade.").await,
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn link_launcher_minecraft_account(
    api_base_url: String,
    access_token: String,
    payload: PayloadVincularMinecraftSocialLauncherApi,
) -> Result<RespostaSalvarPerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/social/minecraft/link", api_base);

    if payload.minecraft_access_token.trim().is_empty() {
        return Err("minecraftAccessToken obrigatório para vincular conta.".to_string());
    }

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao vincular conta Minecraft: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao vincular conta Minecraft.").await,
        );
    }

    resposta
        .json::<RespostaSalvarPerfilSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida ao vincular conta Minecraft: {}", e))
}

#[tauri::command]
pub async fn unlink_launcher_minecraft_account(
    api_base_url: String,
    access_token: String,
    uuid: String,
) -> Result<RespostaSalvarPerfilSocialLauncherApi, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let uuid = uuid.trim().to_lowercase();
    if uuid.is_empty() {
        return Err("UUID inválido para desvincular conta.".to_string());
    }

    let endpoint = format!(
        "{}/api/launcher/social/minecraft/{}",
        api_base,
        urlencoding::encode(&uuid)
    );

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .delete(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao desvincular conta Minecraft: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao desvincular conta Minecraft.",
        )
        .await);
    }

    resposta
        .json::<RespostaSalvarPerfilSocialLauncherApi>()
        .await
        .map_err(|e| format!("Resposta inválida ao desvincular conta Minecraft: {}", e))
}

#[tauri::command]
pub async fn refresh_launcher_social_session(
    api_base_url: String,
    refresh_token: String,
) -> Result<serde_json::Value, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let refresh_token = refresh_token.trim().to_string();
    if refresh_token.is_empty() {
        return Err("refreshToken ausente.".to_string());
    }

    let endpoint = format!("{}/api/launcher/auth/refresh", api_base);
    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao renovar sessao social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao renovar sessao social.").await,
        );
    }

    resposta
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida ao renovar sessao social: {}", e))
}

#[tauri::command]
pub async fn logout_launcher_social(
    api_base_url: String,
    access_token: String,
) -> Result<(), String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let endpoint = format!("{}/api/launcher/auth/logout", api_base);

    let client = criar_cliente_http_launcher()?;
    let resposta = client
        .post(&endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao encerrar sessao social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(
            extrair_mensagem_erro_launcher(resposta, "Falha ao encerrar sessao social.").await,
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn export_launcher_social_sync_package(
    instance_id: String,
    arquivos_configuracao: Option<Vec<String>>,
    arquivos_referencia: Option<Vec<pacotes_sociais::ArquivoSocial>>,
    state: State<'_, LauncherState>,
) -> Result<ResultadoExportacaoSyncSocial, String> {
    let _ = arquivos_referencia;
    let instancia =
        crate::comandos::instancia_sistema::obter_instancia_por_id(&state, &instance_id)?;
    let instancia_previa = instancia.clone();
    let arquivos_selecionados = arquivos_configuracao.clone().unwrap_or_default();
    let previa = tauri::async_runtime::spawn_blocking(move || {
        pacotes_sociais::previa_selecionada(&instancia_previa, &arquivos_selecionados)
    })
    .await
    .map_err(|e| e.to_string())??;
    let previa = pacotes_sociais::identificar_modrinth(previa).await;
    let (caminho, previa) = tauri::async_runtime::spawn_blocking(move || {
        pacotes_sociais::exportar_previa(&instancia, arquivos_configuracao, previa)
    })
    .await
    .map_err(|e| e.to_string())??;
    let metadata = std::fs::metadata(&caminho).map_err(|e| e.to_string())?;
    let caminho = caminho.to_string_lossy().to_string();

    Ok(ResultadoExportacaoSyncSocial {
        caminho_arquivo: caminho,
        tamanho_bytes: metadata.len(),
        previa,
    })
}

async fn enviar_pacote_social(
    app: tauri::AppHandle,
    api_base_url: String,
    access_token: String,
    payload: PayloadUploadSyncSocial,
) -> Result<serde_json::Value, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let token = normalizar_token_social(&access_token)?;
    let pedido_id = payload.pedido_id.trim().to_string();
    let token_upload = payload.token_upload.trim().to_string();
    let caminho_arquivo = payload.caminho_arquivo.trim().to_string();

    if pedido_id.is_empty() || token_upload.is_empty() || caminho_arquivo.is_empty() {
        return Err("Parametros invalidos para upload de sync social.".to_string());
    }

    let caminho_validado = std::path::PathBuf::from(&caminho_arquivo)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let raiz = std::env::temp_dir()
        .join("dome-social-sync")
        .join("outgoing")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !caminho_validado.starts_with(&raiz) {
        return Err("Pacote fora da pasta de envio.".into());
    }
    let _temporario = pacotes_sociais::Temporario(caminho_validado);
    let metadata = std::fs::metadata(&caminho_arquivo)
        .map_err(|e| format!("Arquivo de sync nao encontrado: {}", e))?;
    const LIMITE_PACOTE_SYNC: u64 = pacotes_sociais::LIMITE_PACOTE;
    if metadata.len() > LIMITE_PACOTE_SYNC {
        return Err("Arquivo maior que 2 GiB. Upload rejeitado.".to_string());
    }

    let endpoint_preparar = format!(
        "{}/api/launcher/social/sync/upload/{}/preparar",
        api_base,
        urlencoding::encode(&pedido_id)
    );
    let client = criar_cliente_http_transferencia()?;
    let resposta_preparacao = client
        .post(&endpoint_preparar)
        .bearer_auth(&token)
        .header("x-social-sync-token", &token_upload)
        .json(&serde_json::json!({ "tamanhoBytes": metadata.len() }))
        .send()
        .await
        .map_err(|e| format!("Erro ao preparar upload de sync social: {}", e))?;
    if !resposta_preparacao.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta_preparacao,
            "Falha ao preparar o upload social.",
        )
        .await);
    }
    let preparacao = resposta_preparacao
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta inválida ao preparar upload social: {}", e))?;
    let url_upload = preparacao["urlUpload"]
        .as_str()
        .ok_or("A API não retornou a URL de upload.")?;
    let caminho_remoto = preparacao["caminhoArquivo"]
        .as_str()
        .ok_or("A API não retornou o caminho do upload.")?;
    let url_validada = reqwest::Url::parse(url_upload)
        .map_err(|_| "URL assinada de upload inválida.".to_string())?;
    let host = url_validada.host_str().unwrap_or_default();
    let local = matches!(host, "localhost" | "127.0.0.1" | "::1");
    if url_validada.scheme() != "https" && !(url_validada.scheme() == "http" && local) {
        return Err("URL assinada de upload deve usar HTTPS.".to_string());
    }

    let arquivo = tokio::fs::File::open(&caminho_arquivo)
        .await
        .map_err(|e| format!("Erro ao abrir pacote de sync: {}", e))?;
    let mut progresso = operacoes_sociais::Progresso::novo(
        app,
        pedido_id.clone(),
        Some(metadata.len()),
        "enviando",
    );
    let fluxo = tokio_util::io::ReaderStream::new(arquivo).inspect(move |chunk| {
        if let Ok(dados) = chunk {
            progresso.avancar(dados.len() as u64);
        }
    });
    let corpo = reqwest::Body::wrap_stream(fluxo);

    let resposta = client
        .put(url_validada)
        .header("content-type", "application/octet-stream")
        .header("content-length", metadata.len())
        .body(corpo)
        .send()
        .await
        .map_err(|e| format!("Erro de rede no upload direto do pacote social: {}", e))?;

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha no upload direto do pacote social.",
        )
        .await);
    }

    let endpoint_concluir = format!(
        "{}/api/launcher/social/sync/upload/{}/concluir",
        api_base,
        urlencoding::encode(&pedido_id)
    );
    let resposta_conclusao = client
        .post(&endpoint_concluir)
        .bearer_auth(token)
        .header("x-social-sync-token", token_upload)
        .json(&serde_json::json!({ "caminhoArquivo": caminho_remoto }))
        .send()
        .await
        .map_err(|e| format!("Erro ao confirmar upload de sync social: {}", e))?;
    if !resposta_conclusao.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta_conclusao,
            "Falha ao confirmar o upload social.",
        )
        .await);
    }

    resposta_conclusao
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Resposta invalida no upload de sync social: {}", e))
}

async fn receber_pacote_social(
    app: tauri::AppHandle,
    cancelamento: tokio_util::sync::CancellationToken,
    vinculo: Option<vinculos_sociais::VinculoSocial>,
    api_base_url: String,
    pedido_id: String,
    token_download: String,
    state: State<'_, LauncherState>,
) -> Result<ResultadoDownloadImportacaoSyncSocial, String> {
    let api_base = normalizar_api_base_url(&api_base_url)?;
    let pedido_id = pedido_id.trim().to_string();
    let token_download = token_download.trim().to_string();
    if pedido_id.is_empty() || token_download.is_empty() {
        return Err("pedidoId e tokenDownload sao obrigatorios.".to_string());
    }

    use sha2::{Digest, Sha256};
    let recibos = crate::launcher::pasta_recibos_sociais();
    std::fs::create_dir_all(&recibos).map_err(|e| e.to_string())?;
    let recibo = recibos.join(format!(
        "{:x}.json",
        Sha256::digest(format!("{api_base}/{pedido_id}"))
    ));
    if let Ok(conteudo) = std::fs::read(&recibo) {
        if let Ok(resultado) =
            serde_json::from_slice::<ResultadoDownloadImportacaoSyncSocial>(&conteudo)
        {
            if resultado.instancia_id.as_deref().is_some_and(|id| {
                crate::comandos::instancia_sistema::obter_instancia_por_id(&state, id).is_ok()
            }) {
                return Ok(resultado);
            }
        }
    }

    if let Some(v) = &vinculo {
        if let Some((instancia, anterior)) =
            vinculos_sociais::buscar(&state, &api_base, &v.compartilhamento_id)?
        {
            if anterior.versao == v.versao {
                let locais = pacotes_sociais::previa(&instancia)?.arquivos;
                if v.arquivos.iter().all(|a| {
                    locais
                        .iter()
                        .any(|l| a.caminho == l.caminho && a.sha256 == l.sha256)
                }) {
                    return Ok(ResultadoDownloadImportacaoSyncSocial {
                        pedido_id,
                        caminho_arquivo: String::new(),
                        instancia_id: Some(instancia.id),
                        mensagem: "Versão já instalada.".into(),
                    });
                }
            }
        }
    }
    let endpoint = format!(
        "{}/api/launcher/social/sync/download/{}?token={}",
        api_base,
        urlencoding::encode(&pedido_id),
        urlencoding::encode(&token_download)
    );
    let client = criar_cliente_http_transferencia()?;
    let resposta = tokio::select! {
        resposta = client.get(&endpoint).send() => resposta.map_err(|e| format!("Erro de rede no download: {}", e.without_url()))?,
        _ = cancelamento.cancelled() => return Err("Transferência cancelada.".into()),
    };

    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha no download do pacote social.",
        )
        .await);
    }

    let pasta_temp = std::env::temp_dir()
        .join("dome-social-sync")
        .join("incoming");
    if !pasta_temp.exists() {
        std::fs::create_dir_all(&pasta_temp)
            .map_err(|e| format!("Erro ao criar pasta temporaria de download social: {}", e))?;
    }

    let nome_arquivo = format!("{}.dome", uuid::Uuid::new_v4());
    let caminho_arquivo = pasta_temp.join(nome_arquivo);
    let _temporario = pacotes_sociais::Temporario(caminho_arquivo.clone());
    let mut arquivo = tokio::fs::File::create(&caminho_arquivo)
        .await
        .map_err(|e| format!("Erro ao criar arquivo temporario de sync: {}", e))?;

    const LIMITE_PACOTE_SYNC: u64 = pacotes_sociais::LIMITE_PACOTE;
    if resposta
        .content_length()
        .is_some_and(|tamanho| tamanho > LIMITE_PACOTE_SYNC)
    {
        return Err("Pacote social excede o limite de 2 GiB.".to_string());
    }

    let mut progresso = operacoes_sociais::Progresso::novo(
        app,
        pedido_id.clone(),
        resposta.content_length(),
        "recebendo",
    );
    let mut tamanho_recebido = 0_u64;
    let mut stream = resposta.bytes_stream();
    loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = cancelamento.cancelled() => return Err("Transferência cancelada.".into()),
        };
        let Some(chunk) = chunk else {
            break;
        };
        let dados =
            chunk.map_err(|e| format!("Erro ao baixar pacote de sync: {}", e.without_url()))?;
        tamanho_recebido += dados.len() as u64;
        progresso.avancar(dados.len() as u64);
        if tamanho_recebido > LIMITE_PACOTE_SYNC {
            drop(arquivo);
            let _ = tokio::fs::remove_file(&caminho_arquivo).await;
            return Err("Pacote social excede o limite de 2 GiB.".to_string());
        }
        arquivo
            .write_all(&dados)
            .await
            .map_err(|e| format!("Erro ao gravar pacote de sync em disco: {}", e))?;
    }

    // Garante que todos os dados foram persistidos e fecha o arquivo para permitir leitura no Windows
    arquivo
        .flush()
        .await
        .map_err(|e| format!("Erro ao finalizar arquivo de sync: {}", e))?;
    drop(arquivo);

    eprintln!(
        "[SocialSync] Download concluído: {} bytes gravados em {:?}",
        tamanho_recebido, caminho_arquivo
    );

    if tamanho_recebido == 0 {
        let _ = tokio::fs::remove_file(&caminho_arquivo).await;
        return Err("Pacote de sync recebido está vazio (0 bytes).".to_string());
    }

    eprintln!("[SocialSync] Iniciando importação da instância...");
    if cancelamento.is_cancelled() {
        return Err("Transferência cancelada.".into());
    }
    let raiz_preparacao = crate::launcher::pasta_preparacao_social();
    std::fs::create_dir_all(&raiz_preparacao).map_err(|e| e.to_string())?;
    let pasta_preparacao = raiz_preparacao.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&pasta_preparacao).map_err(|e| e.to_string())?;
    let _preparacao = pacotes_sociais::PastaTemporaria::nova(&raiz_preparacao, &pasta_preparacao)?;
    let estado_preparacao = LauncherState {
        account: state.account.clone(),
        accounts: state.accounts.clone(),
        processos_instancias: state.processos_instancias.clone(),
        instances_path: std::sync::Arc::new(std::sync::Mutex::new(pasta_preparacao)),
    };
    let mut resultado_importacao =
        crate::aplicacao::importacao_exportacao::importar_instancia_social_em_estado(
            caminho_arquivo.to_string_lossy().to_string(),
            &estado_preparacao,
        )
        .await?;
    let id_preparado = resultado_importacao
        .instancia_id
        .as_deref()
        .ok_or("Instância não foi preparada.")?;
    let instancia = crate::comandos::instancia_sistema::obter_instancia_por_id(
        &estado_preparacao,
        id_preparado,
    )?;
    pacotes_sociais::restaurar_referencias(
        &caminho_arquivo,
        &instancia.path,
        &crate::launcher::pasta_cache_social(),
    )
    .await?;
    if let Some(v) = &vinculo {
        if v.api_base_url != api_base || v.compartilhamento_id.is_empty() {
            return Err("Vínculo inválido.".into());
        }
        let recebidos = pacotes_sociais::previa(&instancia)?.arquivos;
        if recebidos.len() != v.arquivos.len()
            || recebidos.iter().any(|a| {
                !v.arquivos
                    .iter()
                    .any(|b| a.caminho == b.caminho && a.sha256 == b.sha256)
            })
        {
            return Err("O conteúdo recebido difere da versão revisada.".into());
        }
    }
    if cancelamento.is_cancelled() {
        return Err("Transferência cancelada.".into());
    }
    let estado_final = LauncherState {
        account: state.account.clone(),
        accounts: state.accounts.clone(),
        processos_instancias: state.processos_instancias.clone(),
        instances_path: state.instances_path.clone(),
    };
    let instancia = tauri::async_runtime::spawn_blocking(move || {
        vinculos_sociais::publicar_local(&estado_final, instancia, vinculo)
    })
    .await
    .map_err(|e| e.to_string())??;
    resultado_importacao.instancia_id = Some(instancia.id);

    eprintln!(
        "[SocialSync] Instância importada com sucesso: {:?}",
        resultado_importacao.instancia_id
    );

    // Limpa arquivo temporário baixado
    let _ = tokio::fs::remove_file(&caminho_arquivo).await;

    let resultado = ResultadoDownloadImportacaoSyncSocial {
        pedido_id,
        caminho_arquivo: String::new(),
        instancia_id: resultado_importacao.instancia_id,
        mensagem: resultado_importacao.mensagem,
    };
    let temporario_recibo = recibo.with_extension("tmp");
    std::fs::write(
        &temporario_recibo,
        serde_json::to_vec(&resultado).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporario_recibo, recibo).map_err(|e| e.to_string())?;
    Ok(resultado)
}

fn normalizar_token_social(access_token: &str) -> Result<String, String> {
    let token = access_token.trim().to_string();
    if token.is_empty() {
        return Err("Token social ausente.".to_string());
    }

    Ok(token)
}

/// Publica (ou atualiza, caso já exista uma do autor para o projeto) a análise
/// de um modpack do Modrinth/CurseForge. Instâncias personalizadas não possuem
/// `source`/`projectId` e são recusadas pela API.
#[tauri::command]
pub async fn publicar_analise_modpack(
    api_base_url: String,
    access_token: String,
    dados: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let fonte = dados
        .get("source")
        .and_then(|valor| valor.as_str())
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if fonte != "modrinth" && fonte != "curseforge" {
        return Err(
            "Análises só podem ser publicadas para modpacks do Modrinth ou CurseForge.".to_string(),
        );
    }
    if dados
        .get("projectId")
        .and_then(|valor| valor.as_str())
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err("Projeto do modpack inválido.".to_string());
    }
    if dados
        .get("conteudo")
        .and_then(|valor| valor.as_str())
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err("Escreva sua análise antes de publicar.".to_string());
    }
    let resposta = criar_cliente_http_launcher()?
        .post(format!(
            "{}/api/launcher/social/analises",
            normalizar_api_base_url(&api_base_url)?
        ))
        .bearer_auth(normalizar_token_social(&access_token)?)
        .json(&dados)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao publicar análise: {}", e))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao publicar análise.").await);
    }
    let dados_resposta: serde_json::Value = resposta.json().await.map_err(|e| e.to_string())?;
    dados_resposta
        .get("analise")
        .cloned()
        .ok_or("A API não retornou a análise publicada.".into())
}

#[tauri::command]
pub async fn listar_analises_perfil(
    api_base_url: String,
    access_token: String,
    perfil_id: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let destino = perfil_id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| "me".into());
    let endpoint = format!(
        "{}/api/launcher/social/profile/{}/analises",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(&destino)
    );
    let resposta = criar_cliente_http_launcher()?
        .get(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao carregar análises: {}", e))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao carregar análises.").await);
    }
    let dados: serde_json::Value = resposta.json().await.map_err(|e| e.to_string())?;
    serde_json::from_value(dados.get("analises").cloned().unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn listar_analises_projeto(
    api_base_url: String,
    access_token: String,
    source: String,
    project_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let fonte = source.trim().to_lowercase();
    if fonte != "modrinth" && fonte != "curseforge" {
        return Err("Fonte do projeto inválida.".to_string());
    }
    if project_id.trim().is_empty() {
        return Err("Projeto inválido.".to_string());
    }
    let endpoint = format!(
        "{}/api/launcher/social/analises/projeto?source={}&projectId={}",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(&fonte),
        urlencoding::encode(project_id.trim())
    );
    let resposta = criar_cliente_http_launcher()?
        .get(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao carregar análises do projeto: {}", e))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(
            resposta,
            "Falha ao carregar análises do projeto.",
        )
        .await);
    }
    let dados: serde_json::Value = resposta.json().await.map_err(|e| e.to_string())?;
    serde_json::from_value(dados.get("analises").cloned().unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn curtir_analise_modpack(
    api_base_url: String,
    access_token: String,
    analise_id: String,
) -> Result<serde_json::Value, String> {
    if analise_id.trim().is_empty() {
        return Err("Análise inválida.".to_string());
    }
    let endpoint = format!(
        "{}/api/launcher/social/analises/{}/curtir",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(analise_id.trim())
    );
    let resposta = criar_cliente_http_launcher()?
        .post(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao curtir análise: {}", e))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao curtir análise.").await);
    }
    resposta.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn excluir_analise_modpack(
    api_base_url: String,
    access_token: String,
    analise_id: String,
) -> Result<(), String> {
    if analise_id.trim().is_empty() {
        return Err("Análise inválida.".to_string());
    }
    let endpoint = format!(
        "{}/api/launcher/social/analises/{}",
        normalizar_api_base_url(&api_base_url)?,
        urlencoding::encode(analise_id.trim())
    );
    let resposta = criar_cliente_http_launcher()?
        .delete(endpoint)
        .bearer_auth(normalizar_token_social(&access_token)?)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao excluir análise: {}", e))?;
    if !resposta.status().is_success() {
        return Err(extrair_mensagem_erro_launcher(resposta, "Falha ao excluir análise.").await);
    }
    Ok(())
}

#[cfg(test)]
mod testes {
    use super::normalizar_api_base_url;

    #[test]
    fn aceita_https_e_remove_barra_final() {
        let url = normalizar_api_base_url("https://api.domestudios.com.br/").unwrap();
        assert_eq!(url, "https://api.domestudios.com.br");
    }

    #[test]
    fn permite_http_apenas_em_desenvolvimento_local() {
        assert!(normalizar_api_base_url("http://localhost:3000").is_ok());
        assert!(normalizar_api_base_url("http://api.domestudios.com.br").is_err());
    }
}

#[tauri::command]
pub async fn upload_launcher_social_sync_package(
    app: tauri::AppHandle,
    api_base_url: String,
    access_token: String,
    payload: PayloadUploadSyncSocial,
) -> Result<serde_json::Value, String> {
    let operacao = operacoes_sociais::Operacao::iniciar(&payload.pedido_id)?;
    tokio::select! {
        resultado = enviar_pacote_social(app, api_base_url, access_token, payload) => resultado,
        _ = operacao.token.cancelled() => Err("Transferência cancelada.".into()),
    }
}

#[tauri::command]
pub async fn download_import_launcher_social_sync_package(
    app: tauri::AppHandle,
    api_base_url: String,
    pedido_id: String,
    token_download: String,
    state: State<'_, LauncherState>,
    vinculo: Option<vinculos_sociais::VinculoSocial>,
) -> Result<ResultadoDownloadImportacaoSyncSocial, String> {
    let chave = vinculo
        .as_ref()
        .map(|v| format!("compartilhamento:{}", v.compartilhamento_id))
        .unwrap_or_else(|| pedido_id.clone());
    let _trava_vinculo = if chave != pedido_id {
        Some(operacoes_sociais::Operacao::iniciar(&chave)?)
    } else {
        None
    };
    let operacao = operacoes_sociais::Operacao::iniciar(&pedido_id)?;
    receber_pacote_social(
        app,
        operacao.token.clone(),
        vinculo,
        api_base_url,
        pedido_id,
        token_download,
        state,
    )
    .await
}
