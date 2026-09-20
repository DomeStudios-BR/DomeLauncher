use crate::launcher::{Instance, LauncherState};
use serde::{Deserialize, Serialize};
use tauri::State;

pub(crate) fn caminho_instancia_por_id(
    state: &LauncherState,
    instance_id: &str,
) -> Result<std::path::PathBuf, String> {
    let id = instance_id.trim();
    if !identificador_instancia_valido(id) {
        return Err("Identificador de instância inválido.".to_string());
    }

    let caminho_padrao = state.caminho_instancias()?.join(id);
    if caminho_padrao.exists() {
        return Ok(caminho_padrao);
    }

    // Fallback de resiliência: se a pasta com o ID exato não existir diretamente,
    // busca entre as pastas existentes uma cujo instance.json tenha esse ID.
    if let Ok(raiz) = state.caminho_instancias() {
        if let Ok(entries) = std::fs::read_dir(&raiz) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let config_path = entry.path().join("instance.json");
                    if config_path.exists() {
                        if let Ok(conteudo) = std::fs::read_to_string(&config_path) {
                            if let Ok(instancia) = serde_json::from_str::<Instance>(&conteudo) {
                                if instancia.id == id {
                                    return Ok(entry.path());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(caminho_padrao)
}

fn identificador_instancia_valido(id: &str) -> bool {
    let mut componentes = std::path::Path::new(id).components();
    let componente_valido = matches!(componentes.next(), Some(std::path::Component::Normal(_)))
        && componentes.next().is_none();
    !id.is_empty() && componente_valido && id != "." && id != ".."
}

fn normalizar_caminho_processo(caminho: &std::path::Path) -> String {
    let normalizado = caminho.to_string_lossy().to_lowercase().replace('\\', "/");

    normalizado
        .strip_prefix("//?/")
        .unwrap_or(&normalizado)
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn obter_instancia_por_id(
    state: &LauncherState,
    instance_id: &str,
) -> Result<Instance, String> {
    state
        .get_instances()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|instancia| {
            instancia.id == instance_id
                || instancia
                    .path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|nome| nome == instance_id)
        })
        .ok_or_else(|| "Instância não encontrada".to_string())
}

pub(crate) fn validar_caminho_dentro_raiz(
    raiz: &std::path::Path,
    alvo: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let raiz_can = raiz
        .canonicalize()
        .map_err(|e| format!("Falha ao normalizar raiz de segurança: {}", e))?;
    let alvo_can = alvo
        .canonicalize()
        .map_err(|e| format!("Falha ao normalizar caminho alvo: {}", e))?;

    if !alvo_can.starts_with(&raiz_can) {
        return Err("Caminho fora do diretório permitido.".to_string());
    }

    Ok(alvo_can)
}

pub(crate) fn nome_arquivo_valido_log(nome: &str) -> bool {
    nome.ends_with(".log") || nome.ends_with(".txt")
}

// ===== FUNÇÕES DE MONITORAMENTO DO MINECRAFT =====

fn obter_mapa_instancias_em_execucao(
    state: &LauncherState,
    ids_instancia: &[String],
) -> Result<std::collections::HashMap<String, bool>, String> {
    let mut resultados = std::collections::HashMap::new();
    if ids_instancia.is_empty() {
        return Ok(resultados);
    }

    use sysinfo::{ProcessRefreshKind, RefreshKind, System, UpdateKind};

    let detalhes_processo = ProcessRefreshKind::new()
        .with_cmd(UpdateKind::Always)
        .with_cwd(UpdateKind::Always);
    let mut system =
        System::new_with_specifics(RefreshKind::new().with_processes(detalhes_processo));
    system.refresh_processes();

    let processos_java = system
        .processes()
        .values()
        .filter_map(|processo| {
            let nome = processo.name().to_lowercase();
            if !nome.contains("java") {
                return None;
            }

            let cmdline = processo
                .cmd()
                .iter()
                .map(|arg| arg.to_string())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
                .replace('\\', "/");

            let diretorio_trabalho = processo.cwd().map(normalizar_caminho_processo);

            Some((processo.pid().as_u32(), cmdline, diretorio_trabalho))
        })
        .collect::<Vec<_>>();

    for instance_id in ids_instancia {
        let instance_path = match caminho_instancia_por_id(state, instance_id) {
            Ok(caminho) => caminho,
            Err(_) => {
                resultados.insert(instance_id.clone(), false);
                continue;
            }
        };
        if !instance_path.exists() {
            state.remover_pid_instancia(instance_id);
            resultados.insert(instance_id.clone(), false);
            continue;
        }

        let pid_registrado = state.obter_pid_instancia(instance_id);
        let instance_path_normalizado = normalizar_caminho_processo(&instance_path);
        let caminho_canonico_normalizado = instance_path
            .canonicalize()
            .ok()
            .map(|caminho| normalizar_caminho_processo(&caminho));

        let processo_localizado = processos_java
            .iter()
            .find(|(_, cmdline, diretorio_trabalho)| {
                let diretorio_corresponde =
                    diretorio_trabalho.as_deref().is_some_and(|diretorio| {
                        diretorio == instance_path_normalizado
                            || caminho_canonico_normalizado.as_deref() == Some(diretorio)
                    });
                let comando_corresponde = cmdline.contains(&instance_path_normalizado)
                    || caminho_canonico_normalizado
                        .as_deref()
                        .is_some_and(|caminho| cmdline.contains(caminho));

                diretorio_corresponde || comando_corresponde
            });

        if let Some((pid, _, _)) = processo_localizado {
            if pid_registrado != Some(*pid) {
                state.registrar_processo_instancia(instance_id, *pid);
                state.iniciar_monitoramento_tempo_jogado(instance_id, *pid);
            }
            resultados.insert(instance_id.clone(), true);
            continue;
        }

        if pid_registrado.is_some() {
            state.remover_pid_instancia(instance_id);
            if let Err(erro) = state.finalizar_tempo_jogado_instancia(instance_id) {
                eprintln!(
                    "[Instâncias] Aviso: falha ao finalizar sessão obsoleta da instância {}: {}",
                    instance_id, erro
                );
            }
        }
        resultados.insert(instance_id.clone(), false);
    }

    Ok(resultados)
}

#[tauri::command]
pub fn is_instance_running(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<bool, String> {
    let mapa = obter_mapa_instancias_em_execucao(&state, std::slice::from_ref(&instance_id))?;
    Ok(*mapa.get(&instance_id).unwrap_or(&false))
}

#[tauri::command]
pub fn get_running_instances(
    instance_ids: Vec<String>,
    state: State<LauncherState>,
) -> Result<std::collections::HashMap<String, bool>, String> {
    let ids_unicos = instance_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    obter_mapa_instancias_em_execucao(&state, &ids_unicos)
}

#[tauri::command]
pub fn kill_instance(instance_id: String, state: State<LauncherState>) -> Result<(), String> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System, UpdateKind};

    let instance_path = caminho_instancia_por_id(&state, &instance_id)?;
    if !instance_path.exists() {
        state.remover_pid_instancia(&instance_id);
        return Err("Instância não encontrada".to_string());
    }

    let instance_path_normalizado = instance_path
        .to_string_lossy()
        .to_lowercase()
        .replace('\\', "/");

    let mut system = System::new_with_specifics(
        RefreshKind::new().with_processes(ProcessRefreshKind::new().with_cmd(UpdateKind::Always)),
    );
    system.refresh_processes();

    let mut finalizados = 0usize;

    if let Some(pid) = state.obter_pid_instancia(&instance_id) {
        let pid_sistema = sysinfo::Pid::from_u32(pid);
        if let Some(processo) = system.process(pid_sistema) {
            if processo.kill() {
                finalizados += 1;
            }
        }
    }

    if finalizados == 0 {
        for processo in system.processes().values() {
            let nome = processo.name().to_lowercase();
            if !nome.contains("java") {
                continue;
            }

            let cmdline = processo
                .cmd()
                .iter()
                .map(|arg| arg.to_string())
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
                .replace('\\', "/");

            if cmdline.contains(&instance_path_normalizado) && processo.kill() {
                finalizados += 1;
            }
        }
    }

    state.remover_pid_instancia(&instance_id);
    if let Err(erro) = state.finalizar_tempo_jogado_instancia(&instance_id) {
        eprintln!(
            "[Instâncias] Aviso: falha ao finalizar tempo jogado da instância {}: {}",
            instance_id, erro
        );
    }

    if finalizados == 0 {
        println!(
            "[Instâncias] A instância {} já estava encerrada; o estado obsoleto foi removido.",
            instance_id
        );
    }
    Ok(())
}

// ===== FUNÇÕES DE MUNDOS =====

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub name: String,
    pub path: String,
    pub game_mode: String,
    pub difficulty: String,
    pub last_played: String,
    pub size_on_disk: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub icon: Option<String>,
    pub motd: Option<String>,
    pub player_count: Option<String>,
    pub ping: Option<u32>,
}

fn porta_servidor_padrao() -> u16 {
    25565
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ServidorPersistido {
    pub name: String,
    pub address: String,
    #[serde(default = "porta_servidor_padrao")]
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

fn separar_endereco_porta(endereco: &str) -> (String, u16) {
    let endereco_limpo = endereco.trim();

    if endereco_limpo.is_empty() {
        return (String::new(), porta_servidor_padrao());
    }

    if let Some((host, porta_str)) = endereco_limpo.rsplit_once(':') {
        if host.contains(':') {
            // Endereço IPv6 sem colchetes, manter como está com porta padrão.
            return (endereco_limpo.to_string(), porta_servidor_padrao());
        }

        if let Ok(porta) = porta_str.parse::<u16>() {
            return (host.trim().to_string(), porta);
        }
    }

    (endereco_limpo.to_string(), porta_servidor_padrao())
}

fn caminho_servidores_json_instancia(instancia: &Instance) -> std::path::PathBuf {
    instancia.path.join("servers.json")
}

fn caminho_servidores_dat_instancia(instancia: &Instance) -> std::path::PathBuf {
    instancia.path.join("servers.dat")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServidorDatPersistido {
    #[serde(default)]
    hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(default)]
    ip: String,
    #[serde(default)]
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    accept_textures: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServidoresDatPersistidos {
    #[serde(default)]
    servers: Vec<ServidorDatPersistido>,
}

fn normalizar_servidores_unicos(servidores: Vec<ServidorPersistido>) -> Vec<ServidorPersistido> {
    use std::collections::HashSet;

    let mut vistos = HashSet::new();
    let mut resultado = Vec::new();

    for servidor in servidores {
        if servidor.address.trim().is_empty() {
            continue;
        }

        let chave = format!("{}:{}", servidor.address.to_lowercase(), servidor.port);
        if vistos.insert(chave) {
            resultado.push(servidor);
        }
    }

    resultado
}

fn carregar_servidores_json_instancia(
    instancia: &Instance,
) -> Result<Vec<ServidorPersistido>, String> {
    let caminho = caminho_servidores_json_instancia(instancia);

    if !caminho.exists() {
        return Ok(Vec::new());
    }

    let conteudo = std::fs::read_to_string(&caminho)
        .map_err(|e| format!("Erro ao ler servers.json: {}", e))?;

    serde_json::from_str::<Vec<ServidorPersistido>>(&conteudo)
        .map_err(|e| format!("Erro ao parsear servers.json: {}", e))
}

fn carregar_servidores_dat_instancia(
    instancia: &Instance,
) -> Result<Vec<ServidorPersistido>, String> {
    let caminho = caminho_servidores_dat_instancia(instancia);
    if !caminho.exists() {
        return Ok(Vec::new());
    }

    let dados = std::fs::read(&caminho).map_err(|e| format!("Erro ao ler servers.dat: {}", e))?;

    let parsed = quartz_nbt::serde::deserialize::<ServidoresDatPersistidos>(
        &dados,
        quartz_nbt::io::Flavor::Uncompressed,
    )
    .map_err(|e| format!("Erro ao parsear servers.dat: {}", e))?;

    let servidores = parsed
        .0
        .servers
        .into_iter()
        .filter(|s| !s.hidden && !s.ip.trim().is_empty())
        .map(|s| {
            let (host, porta) = separar_endereco_porta(&s.ip);
            ServidorPersistido {
                name: if s.name.trim().is_empty() {
                    host.clone()
                } else {
                    s.name
                },
                address: host,
                port: porta,
                icon: s.icon,
            }
        })
        .collect();

    Ok(servidores)
}

fn salvar_servidores_json_instancia(
    instancia: &Instance,
    servidores: &[ServidorPersistido],
) -> Result<(), String> {
    let caminho = caminho_servidores_json_instancia(instancia);

    if let Some(parent) = caminho.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Erro ao criar diretório de servidores: {}", e))?;
    }

    let conteudo = serde_json::to_string_pretty(servidores)
        .map_err(|e| format!("Erro ao serializar servers.json: {}", e))?;

    std::fs::write(&caminho, conteudo).map_err(|e| format!("Erro ao salvar servers.json: {}", e))
}

fn salvar_servidores_dat_instancia(
    instancia: &Instance,
    servidores: &[ServidorPersistido],
) -> Result<(), String> {
    let caminho = caminho_servidores_dat_instancia(instancia);

    let servidores_dat = ServidoresDatPersistidos {
        servers: servidores
            .iter()
            .map(|s| ServidorDatPersistido {
                hidden: false,
                ip: if s.port == porta_servidor_padrao() {
                    s.address.clone()
                } else {
                    format!("{}:{}", s.address, s.port)
                },
                name: s.name.clone(),
                icon: s.icon.clone(),
                accept_textures: None,
            })
            .collect(),
    };

    let dados =
        quartz_nbt::serde::serialize(&servidores_dat, None, quartz_nbt::io::Flavor::Uncompressed)
            .map_err(|e| format!("Erro ao serializar servers.dat: {}", e))?;

    std::fs::write(&caminho, dados).map_err(|e| format!("Erro ao salvar servers.dat: {}", e))
}

fn carregar_servidores_instancia(instancia: &Instance) -> Result<Vec<ServidorPersistido>, String> {
    let mut servidores = Vec::new();

    match carregar_servidores_dat_instancia(instancia) {
        Ok(mut dados) => servidores.append(&mut dados),
        Err(e) => eprintln!("[Servidores] Aviso ao ler servers.dat: {}", e),
    }

    match carregar_servidores_json_instancia(instancia) {
        Ok(mut dados) => servidores.append(&mut dados),
        Err(e) => eprintln!("[Servidores] Aviso ao ler servers.json: {}", e),
    }

    Ok(normalizar_servidores_unicos(servidores))
}

fn salvar_servidores_instancia(
    instancia: &Instance,
    servidores: &[ServidorPersistido],
) -> Result<(), String> {
    let servidores_unicos = normalizar_servidores_unicos(servidores.to_vec());
    salvar_servidores_json_instancia(instancia, &servidores_unicos)?;

    if let Err(e) = salvar_servidores_dat_instancia(instancia, &servidores_unicos) {
        eprintln!("[Servidores] Aviso ao salvar servers.dat: {}", e);
    }

    Ok(())
}

#[tauri::command]
pub fn get_worlds(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<WorldInfo>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let saves_dir = instance.path.join("saves");
    let mut worlds = vec![];

    if saves_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(saves_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let level_dat = entry.path().join("level.dat");
                    if level_dat.exists() {
                        let world_name = entry
                            .file_name()
                            .to_str()
                            .unwrap_or("Mundo Desconhecido")
                            .to_string();

                        worlds.push(WorldInfo {
                            name: world_name,
                            path: entry.path().to_str().unwrap_or("").to_string(),
                            game_mode: "Survival".to_string(), // Simulado
                            difficulty: "Normal".to_string(),  // Simulado
                            last_played: "Recentemente".to_string(), // Simulado
                            size_on_disk: "100 MB".to_string(), // Simulado
                        });
                    }
                }
            }
        }
    }

    Ok(worlds)
}

#[tauri::command]
pub fn get_servers(
    instance_id: String,
    state: State<LauncherState>,
) -> Result<Vec<ServerInfo>, String> {
    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let servidores = carregar_servidores_instancia(instance)?;

    Ok(servidores
        .into_iter()
        .map(|s| ServerInfo {
            name: s.name,
            address: s.address,
            port: s.port,
            icon: s.icon,
            motd: None,
            player_count: None,
            ping: None,
        })
        .collect())
}

#[derive(Debug, Deserialize)]
struct RespostaStatusServidorMc {
    description: Option<serde_json::Value>,
    players: Option<JogadoresStatusServidorMc>,
    favicon: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JogadoresStatusServidorMc {
    online: u32,
    max: u32,
}

fn escrever_varint_mc(valor: i32, destino: &mut Vec<u8>) {
    let mut valor = valor as u32;
    loop {
        if (valor & !0x7F) == 0 {
            destino.push(valor as u8);
            return;
        }
        destino.push(((valor & 0x7F) | 0x80) as u8);
        valor >>= 7;
    }
}

fn ler_varint_mc<R: std::io::Read>(reader: &mut R) -> std::io::Result<i32> {
    let mut resultado: i32 = 0;
    let mut posicao = 0;

    loop {
        if posicao >= 35 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "VarInt muito grande",
            ));
        }

        let mut buffer = [0u8; 1];
        reader.read_exact(&mut buffer)?;
        let byte = buffer[0];

        resultado |= ((byte & 0x7F) as i32) << posicao;

        if (byte & 0x80) == 0 {
            return Ok(resultado);
        }

        posicao += 7;
    }
}

fn escrever_string_mc(valor: &str, destino: &mut Vec<u8>) {
    escrever_varint_mc(valor.len() as i32, destino);
    destino.extend_from_slice(valor.as_bytes());
}

fn extrair_texto_descricao_mc(valor: &serde_json::Value) -> Option<String> {
    match valor {
        serde_json::Value::String(texto) => {
            if texto.is_empty() {
                None
            } else {
                Some(texto.to_string())
            }
        }
        serde_json::Value::Object(objeto) => {
            let mut partes: Vec<String> = Vec::new();

            if let Some(texto) = objeto.get("text").and_then(|v| v.as_str()) {
                if !texto.is_empty() {
                    partes.push(texto.to_string());
                }
            }

            if let Some(extra) = objeto.get("extra").and_then(|v| v.as_array()) {
                for item in extra {
                    if let Some(texto) = extrair_texto_descricao_mc(item) {
                        partes.push(texto);
                    }
                }
            }

            if partes.is_empty() {
                None
            } else {
                Some(partes.join(""))
            }
        }
        serde_json::Value::Array(lista) => {
            let partes: Vec<String> = lista
                .iter()
                .filter_map(extrair_texto_descricao_mc)
                .collect();

            if partes.is_empty() {
                None
            } else {
                Some(partes.join(""))
            }
        }
        _ => None,
    }
}

type ResultadoStatusServidor = (u32, Option<String>, Option<String>, Option<String>);

fn consultar_status_servidor_minecraft(
    socket_addr: std::net::SocketAddr,
    host_para_handshake: &str,
    porta: u16,
    timeout: std::time::Duration,
) -> Result<ResultadoStatusServidor, String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    let inicio = std::time::Instant::now();
    let mut stream = TcpStream::connect_timeout(&socket_addr, timeout)
        .map_err(|e| format!("Falha ao conectar para status: {}", e))?;

    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("Falha ao configurar timeout de leitura: {}", e))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("Falha ao configurar timeout de escrita: {}", e))?;

    let mut payload_handshake = Vec::new();
    escrever_varint_mc(0x00, &mut payload_handshake); // packet id
    escrever_varint_mc(-1, &mut payload_handshake); // protocol version auto
    escrever_string_mc(host_para_handshake, &mut payload_handshake);
    payload_handshake.extend_from_slice(&porta.to_be_bytes());
    escrever_varint_mc(0x01, &mut payload_handshake); // next state status

    let mut pacote_handshake = Vec::new();
    escrever_varint_mc(payload_handshake.len() as i32, &mut pacote_handshake);
    pacote_handshake.extend_from_slice(&payload_handshake);
    stream
        .write_all(&pacote_handshake)
        .map_err(|e| format!("Falha ao enviar handshake: {}", e))?;

    // Request status (packet length 1, packet id 0)
    stream
        .write_all(&[0x01, 0x00])
        .map_err(|e| format!("Falha ao enviar request de status: {}", e))?;

    let _packet_len = ler_varint_mc(&mut stream)
        .map_err(|e| format!("Falha ao ler tamanho do pacote de status: {}", e))?;
    let packet_id = ler_varint_mc(&mut stream)
        .map_err(|e| format!("Falha ao ler id do pacote de status: {}", e))?;

    if packet_id != 0 {
        return Err(format!(
            "Pacote de status inválido (id esperado 0, recebido {})",
            packet_id
        ));
    }

    let tamanho_json = ler_varint_mc(&mut stream)
        .map_err(|e| format!("Falha ao ler tamanho do JSON de status: {}", e))?;
    if tamanho_json <= 0 || tamanho_json > 2_000_000 {
        return Err("Tamanho de resposta de status inválido".to_string());
    }

    let mut json_bytes = vec![0u8; tamanho_json as usize];
    stream
        .read_exact(&mut json_bytes)
        .map_err(|e| format!("Falha ao ler JSON de status: {}", e))?;

    let json_texto = String::from_utf8(json_bytes)
        .map_err(|e| format!("Resposta de status inválida (UTF-8): {}", e))?;

    let status: RespostaStatusServidorMc =
        serde_json::from_str(&json_texto).map_err(|e| format!("JSON de status inválido: {}", e))?;

    let ping = inicio.elapsed().as_millis() as u32;
    let motd = status
        .description
        .as_ref()
        .and_then(extrair_texto_descricao_mc);
    let player_count = status
        .players
        .as_ref()
        .map(|p| format!("{}/{}", p.online, p.max));

    Ok((ping, motd, player_count, status.favicon))
}

async fn resolver_srv_minecraft(host: &str) -> Option<(String, u16)> {
    use hickory_resolver::TokioAsyncResolver;
    use std::time::Duration;

    if host.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }

    let resolver = TokioAsyncResolver::tokio_from_system_conf().ok()?;
    let nome_consulta = format!("_minecraft._tcp.{}", host.trim_end_matches('.'));
    let resposta = tokio::time::timeout(
        Duration::from_millis(1_500),
        resolver.srv_lookup(nome_consulta),
    )
    .await
    .ok()?
    .ok()?;

    resposta
        .iter()
        .min_by_key(|registro| registro.priority())
        .map(|registro| {
            (
                registro
                    .target()
                    .to_utf8()
                    .trim_end_matches('.')
                    .to_string(),
                registro.port(),
            )
        })
}

#[tauri::command]
pub async fn ping_server(address: String) -> Result<ServerInfo, String> {
    use std::net::TcpStream;
    use std::net::ToSocketAddrs;
    use std::time::Duration;

    let (host, porta) = separar_endereco_porta(&address);
    if host.is_empty() {
        return Err("Endereço do servidor inválido".to_string());
    }

    let endereco_tem_porta_explicita = address
        .trim()
        .rsplit_once(':')
        .map(|(h, p)| !h.contains(':') && p.parse::<u16>().is_ok())
        .unwrap_or(false);

    let mut destinos: Vec<(String, u16)> = vec![(host.clone(), porta)];
    if !endereco_tem_porta_explicita {
        if let Some((srv_host, srv_port)) = resolver_srv_minecraft(&host).await {
            if !srv_host.is_empty()
                && !destinos
                    .iter()
                    .any(|(h, p)| h.eq_ignore_ascii_case(&srv_host) && *p == srv_port)
            {
                destinos.insert(0, (srv_host, srv_port));
            }
        }
    }

    let mut ultimo_erro: Option<String> = None;
    let timeout = Duration::from_secs(5);

    for (host_destino, porta_destino) in destinos {
        let destino = format!("{}:{}", host_destino, porta_destino);
        let enderecos = destino
            .to_socket_addrs()
            .map_err(|e| format!("Falha ao resolver endereço do servidor: {}", e))?;

        for socket_addr in enderecos {
            match consultar_status_servidor_minecraft(socket_addr, &host, porta_destino, timeout) {
                Ok((ping, motd, player_count, icon)) => {
                    return Ok(ServerInfo {
                        name: host.clone(),
                        address: host_destino.clone(),
                        port: porta_destino,
                        icon,
                        motd,
                        player_count,
                        ping: Some(ping),
                    });
                }
                Err(status_error) => {
                    // Fallback: conexão TCP simples.
                    let inicio = std::time::Instant::now();
                    match TcpStream::connect_timeout(&socket_addr, timeout) {
                        Ok(_stream) => {
                            let ping = inicio.elapsed().as_millis() as u32;
                            return Ok(ServerInfo {
                                name: host.clone(),
                                address: host_destino.clone(),
                                port: porta_destino,
                                icon: None,
                                motd: None,
                                player_count: None,
                                ping: Some(ping),
                            });
                        }
                        Err(connect_error) => {
                            ultimo_erro = Some(format!("{} | {}", status_error, connect_error));
                        }
                    }
                }
            }
        }
    }

    let erro = format!(
        "Servidor offline ou inacessível{}",
        ultimo_erro.map(|e| format!(": {}", e)).unwrap_or_default()
    );
    eprintln!("Falha ao consultar status de {address}: {erro}");
    Err(erro)
}

#[tauri::command]
pub fn add_server(
    instance_id: String,
    name: String,
    address: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let nome_limpo = name.trim();
    if nome_limpo.is_empty() {
        return Err("Nome do servidor não pode ser vazio".to_string());
    }

    let (host, porta) = separar_endereco_porta(&address);
    if host.is_empty() {
        return Err("Endereço do servidor não pode ser vazio".to_string());
    }

    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mut servidores = carregar_servidores_instancia(instance)?;

    if let Some(existente) = servidores
        .iter_mut()
        .find(|s| s.address.eq_ignore_ascii_case(&host) && s.port == porta)
    {
        existente.name = nome_limpo.to_string();
        salvar_servidores_instancia(instance, &servidores)?;
        return Ok(());
    }

    servidores.push(ServidorPersistido {
        name: nome_limpo.to_string(),
        address: host,
        port: porta,
        icon: None,
    });

    salvar_servidores_instancia(instance, &servidores)?;
    Ok(())
}

#[tauri::command]
pub fn remove_server(
    instance_id: String,
    address: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let (host, porta) = separar_endereco_porta(&address);
    if host.is_empty() {
        return Err("Endereço do servidor inválido".to_string());
    }

    let instances = state.get_instances().map_err(|e| e.to_string())?;
    let instance = instances
        .iter()
        .find(|i: &&Instance| i.id == instance_id)
        .ok_or("Instância não encontrada")?;

    let mut servidores = carregar_servidores_instancia(instance)?;
    let tamanho_antes = servidores.len();
    let remover_apenas_por_host = !address.contains(':');

    servidores.retain(|s| {
        if remover_apenas_por_host {
            !s.address.eq_ignore_ascii_case(&host)
        } else {
            !(s.address.eq_ignore_ascii_case(&host) && s.port == porta)
        }
    });

    if servidores.len() == tamanho_antes {
        return Err("Servidor não encontrado nesta instância".to_string());
    }

    salvar_servidores_instancia(instance, &servidores)?;
    Ok(())
}

#[tauri::command]
pub fn delete_world(
    instance_id: String,
    world_path: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let saves_dir = instancia.path.join("saves");

    if !saves_dir.exists() {
        return Err("A pasta de saves da instância não existe.".to_string());
    }

    let caminho_bruto = std::path::PathBuf::from(&world_path);
    if !caminho_bruto.exists() {
        return Ok(());
    }

    let caminho_validado = validar_caminho_dentro_raiz(&saves_dir, &caminho_bruto)?;
    if !caminho_validado.is_dir() {
        return Err("O caminho informado não é um mundo válido.".to_string());
    }

    std::fs::remove_dir_all(caminho_validado).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn abrir_pasta_mundo(
    instance_id: String,
    world_path: String,
    state: State<LauncherState>,
) -> Result<(), String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let saves_dir = instancia.path.join("saves");
    let caminho = validar_caminho_dentro_raiz(&saves_dir, std::path::Path::new(&world_path))?;
    if !caminho.is_dir() {
        return Err("O caminho informado não é um mundo válido.".to_string());
    }

    open::that(caminho).map_err(|e| format!("Erro ao abrir pasta do mundo: {}", e))
}

#[cfg(test)]
mod testes {
    use super::{extrair_texto_descricao_mc, identificador_instancia_valido};

    #[test]
    fn preserva_espacos_em_motd_com_componentes() {
        let descricao = serde_json::json!({
            "text": "",
            "extra": [
                { "text": "Rove" },
                " ",
                { "text": "Open Beta" },
                { "text": " · " },
                { "text": "1.21.11" },
                "\n",
                { "text": "Open World Zombie Survival" }
            ]
        });

        assert_eq!(
            extrair_texto_descricao_mc(&descricao).as_deref(),
            Some("Rove Open Beta · 1.21.11\nOpen World Zombie Survival")
        );
    }

    #[test]
    fn aceita_identificadores_simples() {
        assert!(identificador_instancia_valido("fabric_1.21.1"));
        assert!(identificador_instancia_valido("meu%20modpack"));
    }

    #[test]
    fn rejeita_travessia_e_caminhos_absolutos() {
        assert!(!identificador_instancia_valido("../segredo"));
        assert!(!identificador_instancia_valido("pasta/filha"));
        assert!(!identificador_instancia_valido(".."));
        assert!(!identificador_instancia_valido(""));
        #[cfg(windows)]
        assert!(!identificador_instancia_valido("C:\\Windows"));
        #[cfg(not(windows))]
        assert!(!identificador_instancia_valido("/etc/passwd"));
    }

    #[test]
    fn recupera_pasta_quando_id_difere_do_nome_do_diretorio() {
        let temp_dir =
            std::env::temp_dir().join(format!("dome_test_ghost_{}", uuid::Uuid::new_v4()));
        let instances_dir = temp_dir.join("instances");
        std::fs::create_dir_all(&instances_dir).unwrap();

        let folder_path = instances_dir.join("pasta_renomeada");
        std::fs::create_dir_all(&folder_path).unwrap();

        let instance_json = r#"{
            "id": "id_antigo_fantasma",
            "name": "Meu Modpack",
            "version": "1.20.1",
            "mcType": "release",
            "path": "C:\\caminho\\antigo\\invalido",
            "created": "2024-01-01T00:00:00Z"
        }"#;
        std::fs::write(folder_path.join("instance.json"), instance_json).unwrap();

        let state = crate::launcher::LauncherState::new();
        state
            .atualizar_caminho_instancias(instances_dir.clone())
            .unwrap();

        // 1. caminho_instancia_por_id deve resolver para pasta_renomeada mesmo buscando por "id_antigo_fantasma"
        let caminho = super::caminho_instancia_por_id(&state, "id_antigo_fantasma").unwrap();
        assert_eq!(caminho, folder_path);

        // 2. get_instances deve autocurar o instance.id para "pasta_renomeada" e o path para folder_path
        let instancias = state.get_instances().unwrap();
        assert_eq!(instancias.len(), 1);
        assert_eq!(instancias[0].id, "pasta_renomeada");
        assert_eq!(instancias[0].path, folder_path);

        // 3. O arquivo em disco deve ter sido curado
        let conteudo_curado = std::fs::read_to_string(folder_path.join("instance.json")).unwrap();
        assert!(conteudo_curado.contains(r#""id": "pasta_renomeada""#));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
