use super::progresso_operacao::{ler_download, Acompanhamento, CanalProgresso};
use crate::launcher::LauncherState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::State;

pub mod requisitos;

fn cliente_modpack() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("DomeLauncher/1.0 (+https://domestudios.com.br)")
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {}", e))
}

async fn baixar_modpack(cliente: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut ultima_falha = String::new();
    for tentativa in 1..=3 {
        let resultado = async {
            cliente
                .get(url)
                .send()
                .await?
                .error_for_status()?
                .bytes()
                .await
        }
        .await;
        match resultado {
            Ok(bytes) => return Ok(bytes.to_vec()),
            Err(erro) => ultima_falha = erro.to_string(),
        }
        if tentativa < 3 {
            tokio::time::sleep(std::time::Duration::from_secs(tentativa * 2)).await;
        }
    }
    Err(format!(
        "Erro ao baixar modpack após 3 tentativas: {}",
        ultima_falha
    ))
}

fn validar_requisitos_instancia(
    instancia: &crate::launcher::Instance,
    requisitos: &requisitos::RequisitosModpack,
) -> Result<(), String> {
    let loader = instancia
        .loader_type
        .as_deref()
        .unwrap_or("vanilla")
        .to_lowercase();
    let versao = instancia.loader_version.as_deref().map(|versao| {
        versao
            .strip_prefix(&format!("{}-", instancia.version))
            .unwrap_or(versao)
    });
    let versao_exigida = requisitos.versao_loader.as_deref().map(|versao| {
        versao
            .strip_prefix(&format!("{}-", requisitos.versao_minecraft))
            .unwrap_or(versao)
    });
    if instancia.version != requisitos.versao_minecraft
        || loader != requisitos.loader
        || versao != versao_exigida
    {
        return Err(format!(
            "Este modpack exige Minecraft {} com {} {}. Instale uma nova cópia para usar essas versões.",
            requisitos.versao_minecraft,
            requisitos.loader,
            requisitos.versao_loader.as_deref().unwrap_or("")
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInfo {
    pub(crate) project_id: String,
    pub(crate) version_id: String,
    file_id: Option<String>,
    name: String,
    author: String,
    icon: Option<String>,
    slug: String,
    pub(crate) source: String,
    pub(crate) installed_version: String,
    #[serde(default)]
    assinatura_conteudo: Option<String>,
    #[serde(default, skip_deserializing)]
    modificado: bool,
}

pub(crate) const PASTAS_CONTEUDO_MODPACK: [&str; 7] = [
    "mods",
    "resourcepacks",
    "shaderpacks",
    "config",
    "defaultconfigs",
    "kubejs",
    "scripts",
];
const LIMITE_DOWNLOADS_MODPACK: usize = 32;

pub(crate) fn caminho_conteudo_permitido(caminho: &str) -> bool {
    let primeiro = caminho.split('/').next().unwrap_or_default();
    !primeiro.starts_with('.')
        && ![
            "instance.json",
            "modpack.json",
            "modpack-dome.json",
            "modpack-publico.json",
            "modpack-arquivos.json",
            "compartilhamento.json",
            "dome_manifest.json",
            "version_manifest.json",
            "minecraft.jar",
            "saves",
            "screenshots",
            "logs",
            "crash-reports",
            "versions",
            "libraries",
            "assets",
            "natives",
            "temp",
        ]
        .contains(&primeiro)
}

fn montar_url_cdn_curseforge(file_id: u64, nome_arquivo: &str) -> String {
    let id = file_id.to_string();
    let separacao = id.len().saturating_sub(3);
    let (pasta, arquivo) = id.split_at(separacao);
    format!(
        "https://edge.forgecdn.net/files/{}/{}/{}",
        pasta,
        arquivo,
        urlencoding::encode(nome_arquivo)
    )
}

fn listar_arquivos_assinatura(raiz: &Path, atual: &Path, arquivos: &mut Vec<PathBuf>) {
    let Ok(entradas) = std::fs::read_dir(atual) else {
        return;
    };
    for entrada in entradas.flatten() {
        let caminho = entrada.path();
        let Ok(tipo) = entrada.file_type() else {
            continue;
        };
        if tipo.is_dir() {
            listar_arquivos_assinatura(raiz, &caminho, arquivos);
        } else if tipo.is_file() && caminho.strip_prefix(raiz).is_ok() {
            arquivos.push(caminho);
        }
    }
}

fn assinar_conteudo_modpack(raiz: &Path) -> String {
    let mut arquivos = Vec::new();
    for pasta in PASTAS_CONTEUDO_MODPACK {
        listar_arquivos_assinatura(raiz, &raiz.join(pasta), &mut arquivos);
    }
    arquivos.sort();

    let mut hash = Sha256::new();
    for caminho in arquivos {
        let Ok(relativo) = caminho.strip_prefix(raiz) else {
            continue;
        };
        hash.update(relativo.to_string_lossy().replace('\\', "/").as_bytes());
        if let Ok(metadados) = std::fs::metadata(&caminho) {
            hash.update(metadados.len().to_le_bytes());
            if let Ok(modificado) = metadados.modified() {
                if let Ok(duracao) = modificado.duration_since(std::time::UNIX_EPOCH) {
                    hash.update(duracao.as_nanos().to_le_bytes());
                }
            }
        }
    }
    format!("{:x}", hash.finalize())
}

#[tauri::command]
pub async fn save_modpack_info(
    state: State<'_, LauncherState>,
    instance_id: String,
    modpack_info: ModpackInfo,
) -> Result<(), String> {
    let instance_path =
        crate::comandos::instancia_sistema::caminho_instancia_por_id(&state, &instance_id)?;
    salvar_info_em_pasta(&instance_path, modpack_info)
}

pub(crate) fn salvar_info_em_pasta(
    instance_path: &Path,
    mut modpack_info: ModpackInfo,
) -> Result<(), String> {
    let modpack_path = instance_path.join("modpack.json");

    // Criar diretório se não existir
    if !instance_path.exists() {
        std::fs::create_dir_all(instance_path)
            .map_err(|e| format!("Erro ao criar diretório: {}", e))?;
    }

    modpack_info.assinatura_conteudo = Some(assinar_conteudo_modpack(instance_path));
    modpack_info.modificado = false;
    let content = serde_json::to_string_pretty(&modpack_info)
        .map_err(|e| format!("Erro ao serializar modpack.json: {}", e))?;

    std::fs::write(&modpack_path, content)
        .map_err(|e| format!("Erro ao salvar modpack.json: {}", e))?;

    // Sincronizar ícone da instância com o ícone do modpack.
    if let Some(icone_modpack) = modpack_info
        .icon
        .as_ref()
        .map(|valor| valor.trim().to_string())
        .filter(|valor| !valor.is_empty())
    {
        let instance_json_path = instance_path.join("instance.json");
        if instance_json_path.exists() {
            if let Ok(conteudo_instancia) = std::fs::read_to_string(&instance_json_path) {
                if let Ok(mut json_instancia) =
                    serde_json::from_str::<serde_json::Value>(&conteudo_instancia)
                {
                    if let Some(objeto) = json_instancia.as_object_mut() {
                        objeto.insert("icon".to_string(), serde_json::Value::String(icone_modpack));
                    }
                    let novo_conteudo = serde_json::to_string_pretty(&json_instancia)
                        .map_err(|e| format!("Erro ao serializar instance.json: {}", e))?;
                    std::fs::write(&instance_json_path, novo_conteudo)
                        .map_err(|e| format!("Erro ao atualizar ícone da instância: {}", e))?;
                }
            }
        }
    }

    println!("[save_modpack_info] Salvo: {:?}", modpack_path);
    Ok(())
}

#[tauri::command]
pub async fn install_modpack_files(
    state: State<'_, LauncherState>,
    instance_id: String,
    download_url: String,
    file_name: String,
    substituir_conteudo: Option<bool>,
    progresso: CanalProgresso,
) -> Result<(), String> {
    let instance_path =
        crate::comandos::instancia_sistema::caminho_instancia_por_id(&state, &instance_id)?;
    if state.obter_pid_instancia(&instance_id).is_some() {
        return Err("Feche o jogo antes de instalar o modpack.".into());
    }
    if substituir_conteudo.unwrap_or(false) {
        return Err(
            "Use a troca de versão do modpack para substituir o conteúdo com backup.".into(),
        );
    }
    instalar_arquivos_em_pasta_com_progresso(
        instance_path,
        download_url,
        file_name,
        None,
        &Acompanhamento::novo(progresso.0),
    )
    .await
}

#[cfg(test)]
pub(crate) async fn instalar_arquivos_em_pasta(
    instance_path: PathBuf,
    download_url: String,
    file_name: String,
    pacote: Option<Vec<u8>>,
) -> Result<(), String> {
    instalar_arquivos_em_pasta_com_progresso(
        instance_path,
        download_url,
        file_name,
        pacote,
        &Acompanhamento::default(),
    )
    .await
}

pub(crate) async fn instalar_arquivos_em_pasta_com_progresso(
    instance_path: PathBuf,
    download_url: String,
    file_name: String,
    pacote: Option<Vec<u8>>,
    progresso: &Acompanhamento,
) -> Result<(), String> {
    progresso.informar("Preparando modpack", 0, 1);
    let mods_path = instance_path.join("mods");
    let temp_path = instance_path.join("temp");

    // Criar diretórios
    std::fs::create_dir_all(&mods_path).map_err(|e| format!("Erro ao criar pasta mods: {}", e))?;
    std::fs::create_dir_all(&temp_path).map_err(|e| format!("Erro ao criar pasta temp: {}", e))?;

    let nome_arquivo_seguro = std::path::Path::new(&file_name)
        .file_name()
        .and_then(|nome| nome.to_str())
        .filter(|nome| !nome.trim().is_empty())
        .unwrap_or("modpack.zip")
        .to_string();
    let mrpack_path = temp_path.join(&nome_arquivo_seguro);

    println!("[install_modpack_files] Preparando pacote");

    let client = cliente_modpack()?;
    let mut bytes_modpack = pacote;
    let mut ultima_falha_modpack = String::new();
    for tentativa in 1..=3 {
        if bytes_modpack.is_some() {
            break;
        }
        match client.get(&download_url).send().await {
            Ok(resposta) => {
                if !resposta.status().is_success() {
                    ultima_falha_modpack = format!("HTTP {}", resposta.status());
                } else {
                    match ler_download(resposta, &progresso.faixa(0, 30), "Baixando modpack").await
                    {
                        Ok(bytes) => {
                            bytes_modpack = Some(bytes.to_vec());
                            break;
                        }
                        Err(e) => {
                            ultima_falha_modpack = format!("falha ao ler bytes ({})", e);
                        }
                    }
                }
            }
            Err(e) => {
                ultima_falha_modpack = e.to_string();
            }
        }

        if tentativa < 3 {
            tokio::time::sleep(std::time::Duration::from_secs(tentativa as u64 * 2)).await;
        }
    }

    let bytes = bytes_modpack.ok_or_else(|| {
        format!(
            "Erro ao baixar modpack após 3 tentativas: {}",
            ultima_falha_modpack
        )
    })?;

    std::fs::write(&mrpack_path, &bytes).map_err(|e| format!("Erro ao salvar arquivo: {}", e))?;

    println!("[install_modpack_files] Arquivo salvo: {:?}", mrpack_path);

    // Extrair .mrpack (é um ZIP)
    let file =
        std::fs::File::open(&mrpack_path).map_err(|e| format!("Erro ao abrir mrpack: {}", e))?;

    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Erro ao ler ZIP: {}", e))?;
    progresso.faixa(0, 30).concluir("Pacote recebido");

    let requisitos = requisitos::ler_requisitos(&mut archive)?;
    let conteudo_instancia = std::fs::read_to_string(instance_path.join("instance.json"))
        .map_err(|e| format!("Erro ao ler a instância do modpack: {}", e))?;
    let instancia = serde_json::from_str::<crate::launcher::Instance>(&conteudo_instancia)
        .map_err(|e| format!("Dados da instância do modpack inválidos: {}", e))?;
    validar_requisitos_instancia(&instancia, &requisitos)?;

    // Pode ser Modrinth (modrinth.index.json) ou CurseForge (manifest.json)
    let mut arquivos_para_baixar: Vec<(String, String, String)> = Vec::new();
    let mut hashes_arquivos: HashMap<String, (String, String)> = HashMap::new();
    let mut arquivos_curseforge: Vec<(u64, u64)> = Vec::new();
    let mut total_arquivos_manifesto_curseforge = 0usize;
    let mut pasta_overrides = "overrides".to_string();
    let mut detectou_modrinth = false;
    let mut detectou_curseforge = false;
    let mut erros_curseforge: Vec<String> = Vec::new();

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Erro ao ler arquivo do ZIP: {}", e))?;

        if file.name() == "modrinth.index.json" {
            detectou_modrinth = true;
            let mut contents = String::new();
            std::io::Read::read_to_string(&mut file, &mut contents)
                .map_err(|e| format!("Erro ao ler index Modrinth: {}", e))?;

            let index: serde_json::Value = serde_json::from_str(&contents)
                .map_err(|e| format!("Índice Modrinth inválido: {e}"))?;
            {
                if let Some(files) = index["files"].as_array() {
                    for f in files {
                        if f["env"]["client"] == "unsupported" {
                            continue;
                        }
                        if let (Some(path), Some(downloads)) =
                            (f["path"].as_str(), f["downloads"].as_array())
                        {
                            if let Some(url) = downloads.first().and_then(|d| d.as_str()) {
                                let filename = path.split('/').next_back().unwrap_or("mod.jar");
                                arquivos_para_baixar.push((
                                    url.to_string(),
                                    filename.to_string(),
                                    path.to_string(),
                                ));
                                for algoritmo in ["sha512", "sha1"] {
                                    if let Some(hash) = f["hashes"][algoritmo].as_str() {
                                        hashes_arquivos
                                            .insert(path.into(), (algoritmo.into(), hash.into()));
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if file.name() == "manifest.json" {
            detectou_curseforge = true;
            let mut contents = String::new();
            std::io::Read::read_to_string(&mut file, &mut contents)
                .map_err(|e| format!("Erro ao ler manifest CurseForge: {}", e))?;

            let manifesto: serde_json::Value = serde_json::from_str(&contents)
                .map_err(|e| format!("Manifesto CurseForge inválido: {e}"))?;
            {
                if let Some(overrides) = manifesto["overrides"].as_str() {
                    let normalizado = overrides.trim_matches('/').trim();
                    if !normalizado.is_empty() {
                        pasta_overrides = normalizado.to_string();
                    }
                }

                if let Some(files) = manifesto["files"].as_array() {
                    for entrada in files {
                        let mod_id = entrada["projectID"].as_u64();
                        let file_id = entrada["fileID"].as_u64();
                        if let (Some(mid), Some(fid)) = (mod_id, file_id) {
                            total_arquivos_manifesto_curseforge += 1;
                            arquivos_curseforge.push((mid, fid));
                        }
                    }
                }
            }
        }
    }

    if !arquivos_curseforge.is_empty() {
        let mut pastas_projetos = HashMap::new();
        let projetos: Vec<u64> = arquivos_curseforge.iter().map(|(id, _)| *id).collect();
        for lote in projetos.chunks(50) {
            let dados = super::projetos_conteudo::json_remoto(crate::anexar_headers_curseforge(
                client
                    .post(format!("{}/mods", crate::CURSEFORGE_API_BASE))
                    .json(&serde_json::json!({ "modIds": lote })),
            )?)
            .await?;
            for projeto in dados["data"]
                .as_array()
                .ok_or("Resposta sem projetos CurseForge.")?
            {
                if let Some(id) = projeto["id"].as_u64() {
                    let pasta = match projeto["classId"].as_u64() {
                        Some(12) => "resourcepacks",
                        Some(6552) => "shaderpacks",
                        _ => "mods",
                    };
                    pastas_projetos.insert(id, pasta);
                }
            }
        }
        let ids_arquivos: Vec<u64> = arquivos_curseforge
            .iter()
            .map(|(_, file_id)| *file_id)
            .collect();
        let detalhes_url = format!("{}/mods/files", crate::CURSEFORGE_API_BASE);
        let request = crate::anexar_headers_curseforge(
            client
                .post(&detalhes_url)
                .json(&serde_json::json!({ "fileIds": ids_arquivos })),
        )?;
        let resposta = request
            .send()
            .await
            .map_err(|e| format!("Erro ao buscar arquivos do modpack no CurseForge: {}", e))?;

        if !resposta.status().is_success() {
            return Err(format!(
                "CurseForge retornou HTTP {} ao buscar os arquivos do modpack.",
                resposta.status()
            ));
        }

        let payload: serde_json::Value = resposta
            .json()
            .await
            .map_err(|e| format!("Erro ao interpretar arquivos do CurseForge: {}", e))?;
        let detalhes_por_id: HashMap<u64, serde_json::Value> = payload["data"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|detalhe| detalhe["id"].as_u64().map(|id| (id, detalhe.clone())))
            .collect();

        for (mod_id, file_id) in arquivos_curseforge {
            let Some(data) = detalhes_por_id.get(&file_id) else {
                if erros_curseforge.len() < 8 {
                    erros_curseforge.push(format!(
                        "CurseForge não retornou o arquivo {}:{}",
                        mod_id, file_id
                    ));
                }
                continue;
            };
            let mut url_download = data["downloadUrl"]
                .as_str()
                .unwrap_or("")
                .trim()
                .to_string();

            let file_name = data["fileName"]
                .as_str()
                .filter(|nome| !nome.trim().is_empty())
                .unwrap_or("mod.jar")
                .to_string();

            if url_download.is_empty() && file_name != "mod.jar" {
                url_download = montar_url_cdn_curseforge(file_id, &file_name);
            }

            if url_download.is_empty() {
                if erros_curseforge.len() < 8 {
                    erros_curseforge.push(format!(
                        "Arquivo CurseForge {}:{} sem nome ou URL de download",
                        mod_id, file_id
                    ));
                }
                continue;
            }

            let caminho = format!(
                "{}/{}",
                pastas_projetos.get(&mod_id).copied().unwrap_or("mods"),
                file_name
            );
            if let Some(hash) = data["hashes"]
                .as_array()
                .and_then(|lista| lista.iter().find(|hash| hash["algo"] == 1))
                .and_then(|hash| hash["value"].as_str())
            {
                hashes_arquivos.insert(caminho.clone(), ("sha1".into(), hash.into()));
            }
            arquivos_para_baixar.push((url_download, file_name.clone(), caminho));
        }
    }

    if detectou_curseforge
        && total_arquivos_manifesto_curseforge > 0
        && arquivos_para_baixar.len() != total_arquivos_manifesto_curseforge
    {
        let detalhe = if erros_curseforge.is_empty() {
            "Nenhuma URL válida foi retornada pelo CurseForge.".to_string()
        } else {
            format!("Detalhes: {}", erros_curseforge.join(" | "))
        };
        return Err(format!(
            "Não foi possível obter todos os arquivos do modpack no CurseForge ({}/{} resolvidos). {}",
            arquivos_para_baixar.len(),
            total_arquivos_manifesto_curseforge,
            detalhe,
        ));
    }

    if !detectou_modrinth && !detectou_curseforge {
        return Err("O arquivo não contém modrinth.index.json nem manifest.json.".to_string());
    }

    let prefixo_overrides = format!("{}/", pasta_overrides.trim_matches('/'));
    let mut tamanho_extraido = 0u64;
    let mut caminhos_gerenciados = Vec::<String>::new();
    let total_entradas = archive.len() as u64;
    for i in 0..archive.len() {
        progresso
            .faixa(30, 50)
            .informar("Extraindo modpack", i as u64, total_entradas);
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Erro ao ler arquivo do ZIP: {}", e))?;
        let nome = file.name().replace('\\', "/");
        tamanho_extraido = tamanho_extraido.saturating_add(file.size());
        if tamanho_extraido > super::social_launcher::pacotes_sociais::LIMITE_EXTRAIDO {
            return Err("O pacote excede o limite de extração.".into());
        }
        let Some(relative) = nome
            .strip_prefix(&prefixo_overrides)
            .or_else(|| nome.strip_prefix("client-overrides/"))
        else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        super::social_launcher::pacotes_sociais::validar_nome(relative.trim_end_matches('/'))?;
        if !caminho_conteudo_permitido(relative) {
            continue;
        }
        let dest = instance_path.join(relative);

        if file.is_dir() {
            std::fs::create_dir_all(&dest).ok();
        } else {
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&dest)
                .map_err(|e| format!("Erro ao criar arquivo: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Erro ao copiar arquivo: {}", e))?;
            if ![
                "options.txt",
                "optionsof.txt",
                "optionsshaders.txt",
                "servers.dat",
            ]
            .contains(&relative)
            {
                caminhos_gerenciados.push(relative.into());
            }
        }
    }

    println!(
        "[install_modpack_files] {} mods para baixar",
        arquivos_para_baixar.len()
    );

    // Baixar mods em paralelo
    use futures::stream::{self, StreamExt};
    let concluidos = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let total_downloads = arquivos_para_baixar.len() as u64;

    let download_tasks: Vec<_> = arquivos_para_baixar
        .iter()
        .map(|(url, filename, path)| {
            let client = client.clone();
            let url = url.clone();
            let filename = filename.clone();
            let path = path.clone();
            let hash_esperado = hashes_arquivos.get(&path).cloned();
            let instance_path = instance_path.clone();
            let concluidos = concluidos.clone();
            let progresso_download = progresso.faixa(50, 95);

            async move {
                // Determinar pasta de destino (mods, resourcepacks, etc)
                super::social_launcher::pacotes_sociais::validar_nome(&path)?;
                if !caminho_conteudo_permitido(&path) {
                    return Err(format!("Destino não permitido no modpack: {path}"));
                }
                let dest_path = instance_path.join(&path);
                let dest_folder = dest_path.parent().ok_or("Arquivo sem pasta de destino.")?;
                std::fs::create_dir_all(dest_folder).map_err(|e| e.to_string())?;

                let mut ultima_falha = String::new();
                for tentativa in 1..=2 {
                    match client.get(&url).send().await {
                        Ok(response) => {
                            if !response.status().is_success() {
                                ultima_falha = format!("HTTP {}", response.status());
                            } else {
                                match response.bytes().await {
                                    Ok(bytes) => {
                                        if let Some((algoritmo, esperado)) = &hash_esperado {
                                            let obtido = if algoritmo == "sha1" {
                                                format!("{:x}", sha1::Sha1::digest(&bytes))
                                            } else {
                                                format!("{:x}", sha2::Sha512::digest(&bytes))
                                            };
                                            if !obtido.eq_ignore_ascii_case(esperado) {
                                                return Err(format!(
                                                    "A integridade de {filename} não confere."
                                                ));
                                            }
                                        }
                                        if let Err(e) = std::fs::write(&dest_path, &bytes) {
                                            ultima_falha = format!("erro ao salvar arquivo: {}", e);
                                        } else {
                                            println!(
                                                "[install_modpack_files] Baixado: {}",
                                                filename
                                            );
                                            let atual = concluidos
                                                .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                                                + 1;
                                            progresso_download.informar(
                                                "Baixando arquivos do modpack",
                                                atual,
                                                total_downloads,
                                            );
                                            return Ok::<(), String>(());
                                        }
                                    }
                                    Err(e) => {
                                        ultima_falha = format!("erro ao ler bytes: {}", e);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            ultima_falha = e.to_string();
                        }
                    }

                    if tentativa < 2 {
                        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                    }
                }

                println!(
                    "[install_modpack_files] Falha ao baixar {}: {}",
                    filename, ultima_falha
                );
                Err(format!(
                    "Falha ao baixar {} ({}): {}",
                    filename, url, ultima_falha
                ))
            }
        })
        .collect();

    // Executar downloads em paralelo
    let resultados_download = stream::iter(download_tasks)
        .buffer_unordered(LIMITE_DOWNLOADS_MODPACK)
        .collect::<Vec<_>>()
        .await;
    let total_sucesso = resultados_download.iter().filter(|r| r.is_ok()).count();
    let erros_download: Vec<String> = resultados_download
        .into_iter()
        .filter_map(Result::err)
        .take(8)
        .collect();

    if total_sucesso != arquivos_para_baixar.len() {
        let detalhe_download = if erros_download.is_empty() {
            "sem detalhes do download".to_string()
        } else {
            erros_download.join(" | ")
        };
        let detalhe_curseforge = if erros_curseforge.is_empty() {
            String::new()
        } else {
            format!(" | CurseForge: {}", erros_curseforge.join(" | "))
        };
        return Err(format!(
            "O modpack ficou incompleto: {}/{} arquivos foram baixados. {}{}",
            total_sucesso,
            arquivos_para_baixar.len(),
            detalhe_download,
            detalhe_curseforge,
        ));
    }

    caminhos_gerenciados.extend(
        arquivos_para_baixar
            .iter()
            .map(|(_, _, caminho)| caminho.clone()),
    );
    caminhos_gerenciados.sort();
    caminhos_gerenciados.dedup();
    std::fs::write(
        instance_path.join("modpack-arquivos.json"),
        serde_json::to_vec(&caminhos_gerenciados).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // Limpar arquivos temporários
    std::fs::remove_dir_all(&temp_path).ok();

    println!("[install_modpack_files] Instalação concluída!");
    progresso.concluir("Modpack instalado");
    Ok(())
}

#[tauri::command]
pub async fn get_modpack_info(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<Option<ModpackInfo>, String> {
    let instance_path =
        crate::comandos::instancia_sistema::caminho_instancia_por_id(&state, &instance_id)?;
    let modpack_path = instance_path.join("modpack.json");

    if !modpack_path.exists() {
        return Ok(identificar_modpack_externo(&instance_path));
    }

    let content = std::fs::read_to_string(&modpack_path)
        .map_err(|e| format!("Erro ao ler modpack.json: {}", e))?;

    let mut info: ModpackInfo = serde_json::from_str(&content)
        .map_err(|e| format!("Erro ao parsear modpack.json: {}", e))?;

    info.modificado = info
        .assinatura_conteudo
        .as_ref()
        .is_some_and(|assinatura| assinatura != &assinar_conteudo_modpack(&instance_path));

    Ok(Some(info))
}

pub(crate) fn identificar_modpack_externo(pasta: &Path) -> Option<ModpackInfo> {
    for (arquivo, fonte) in [
        ("minecraftinstance.json", "curseforge"),
        ("profile.json", "modrinth"),
    ] {
        let Ok(bytes) = std::fs::read(pasta.join(arquivo)) else {
            continue;
        };
        let Ok(dados) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        let texto_id = |valor: &serde_json::Value| {
            valor
                .as_str()
                .map(str::to_string)
                .or_else(|| valor.as_u64().map(|id| id.to_string()))
        };
        let (projeto, versao, nome, autor, numero, icone, slug) = if fonte == "curseforge" {
            let pacote = &dados["installedModpack"];
            (
                texto_id(&pacote["addonID"]),
                texto_id(&pacote["installedFile"]["id"]),
                pacote["name"].as_str(),
                pacote["author"].as_str(),
                pacote["installedFile"]["displayName"].as_str(),
                pacote["thumbnailUrl"].as_str(),
                pacote["slug"].as_str(),
            )
        } else {
            let vinculo = dados
                .get("linked_data")
                .or_else(|| dados["metadata"].get("linked_data"))?;
            (
                texto_id(&vinculo["project_id"]),
                texto_id(&vinculo["version_id"]),
                dados["metadata"]["name"]
                    .as_str()
                    .or_else(|| dados["name"].as_str()),
                None,
                None,
                dados["metadata"]["icon_url"].as_str(),
                None,
            )
        };
        if let (Some(projeto), Some(versao)) = (projeto, versao) {
            return serde_json::from_value(serde_json::json!({
                "projectId": projeto, "versionId": versao, "source": fonte,
                "name": nome.unwrap_or("Modpack"), "author": autor.unwrap_or_default(),
                "installedVersion": numero.unwrap_or_default(), "icon": icone, "slug": slug.unwrap_or_default(),
            })).ok();
        }
    }
    None
}

#[tauri::command]
pub async fn check_modpack_updates(
    _instance_id: String,
    project_id: String,
    installed_version: String,
) -> Result<Option<String>, String> {
    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Erro ao verificar atualizações: {}", e))?;

    let versions: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta: {}", e))?;

    if let Some(latest) = versions.first() {
        if let Some(version_number) = latest["version_number"].as_str() {
            if version_number != installed_version {
                return Ok(Some(version_number.to_string()));
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod testes {
    use super::{
        montar_url_cdn_curseforge, requisitos::RequisitosModpack, validar_requisitos_instancia,
    };

    #[test]
    fn exige_versao_exata_antes_de_substituir_conteudo() {
        let mut instancia: crate::launcher::Instance = serde_json::from_value(serde_json::json!({
            "id": "gravitas", "name": "Gravitas²", "version": "1.20.1", "mcType": "Forge",
            "loaderType": "Forge", "loaderVersion": "1.20.1-47.4.10", "path": "gravitas", "created": ""
        })).unwrap();
        let requisitos = RequisitosModpack {
            versao_minecraft: "1.20.1".into(),
            loader: "forge".into(),
            versao_loader: Some("47.4.10".into()),
        };
        assert!(validar_requisitos_instancia(&instancia, &requisitos).is_ok());
        instancia.loader_version = Some("47.4.10".into());
        assert!(validar_requisitos_instancia(&instancia, &requisitos).is_ok());
        instancia.loader_version = Some("47.4.18".into());
        assert!(validar_requisitos_instancia(&instancia, &requisitos).is_err());
        instancia.loader_version = Some("47.4.10".into());
        instancia.loader_type = Some("Fabric".into());
        assert!(validar_requisitos_instancia(&instancia, &requisitos).is_err());
        instancia.loader_type = Some("Forge".into());
        instancia.version = "1.20.2".into();
        assert!(validar_requisitos_instancia(&instancia, &requisitos).is_err());
    }

    #[test]
    fn monta_url_cdn_para_arquivo_sem_download_publico() {
        assert_eq!(
            montar_url_cdn_curseforge(7_906_177, "[NeoForge] Mekanism CTM-Fusion 1.1.zip"),
            "https://edge.forgecdn.net/files/7906/177/%5BNeoForge%5D%20Mekanism%20CTM-Fusion%201.1.zip"
        );
    }
}
