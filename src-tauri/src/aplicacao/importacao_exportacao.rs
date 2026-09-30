use super::*;

use tauri::Emitter;

const EVENTO_PROGRESSO_IMPORTACAO_INSTANCIA: &str = "importacao-instancia-progresso";
const PASTAS_CONTEUDO_IMPORTADO: [&str; 12] = [
    "mods",
    "resourcepacks",
    "shaderpacks",
    "saves",
    "config",
    "defaultconfigs",
    "kubejs",
    "scripts",
    "journeymap",
    "xaeromap",
    "XaeroWaypoints",
    "servers",
];
const ARQUIVOS_CONTEUDO_IMPORTADO: [&str; 5] = [
    "options.txt",
    "optionsof.txt",
    "optionsshaders.txt",
    "servers.dat",
    "usercache.json",
];

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstanciaImportavelExterna {
    pub id_externo: String,
    pub launcher: String,
    pub nome: String,
    pub versao_minecraft: String,
    pub loader_type: Option<String>,
    pub loader_version: Option<String>,
    #[serde(default)]
    pub icone: Option<String>,
    pub caminho_origem: String,
    pub caminho_jogo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoImportacaoInstancia {
    pub id_externo: String,
    pub launcher: String,
    pub nome_origem: String,
    pub sucesso: bool,
    pub instancia_id: Option<String>,
    pub mensagem: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressoImportacaoInstancia {
    id_externo: String,
    etapa: String,
    arquivos_copiados: usize,
    total_arquivos: usize,
    porcentagem: u8,
}

fn listar_instancias_prism() -> Vec<InstanciaImportavelExterna> {
    let Some(base) = directories::BaseDirs::new() else {
        return Vec::new();
    };

    let pasta_instancias = base.data_dir().join("PrismLauncher").join("instances");
    listar_instancias_prism_em(&pasta_instancias)
}

fn listar_instancias_prism_em(
    pasta_instancias: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    if !pasta_instancias.exists() {
        return Vec::new();
    }

    let mut resultados = Vec::new();
    let entradas = match std::fs::read_dir(pasta_instancias) {
        Ok(valor) => valor,
        Err(_) => return resultados,
    };

    for entrada in entradas.flatten() {
        if !entrada.path().is_dir() {
            continue;
        }

        let caminho_origem = entrada.path();
        let caminho_cfg = caminho_origem.join("instance.cfg");
        if !caminho_cfg.exists() {
            continue;
        }

        let cfg = parsear_cfg_simples(&caminho_cfg);
        let nome = cfg
            .get("name")
            .cloned()
            .unwrap_or_else(|| entrada.file_name().to_string_lossy().to_string());

        let mut versao_minecraft = String::new();
        let mut loader_tipo: Option<String> = None;
        let mut loader_versao: Option<String> = None;

        let caminho_mmc_pack = caminho_origem.join("mmc-pack.json");
        if caminho_mmc_pack.exists() {
            if let Ok(conteudo) = std::fs::read_to_string(&caminho_mmc_pack) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&conteudo) {
                    if let Some(componentes) = json.get("components").and_then(|v| v.as_array()) {
                        for componente in componentes {
                            let uid = texto_json_caminho(componente, &["uid"]).unwrap_or_default();
                            let versao = texto_json_caminho(componente, &["version"]);

                            match uid.as_str() {
                                "net.minecraft" if versao_minecraft.is_empty() => {
                                    versao_minecraft = versao.unwrap_or_default();
                                }
                                "net.minecraftforge" => {
                                    loader_tipo = Some("Forge".to_string());
                                    loader_versao = versao;
                                }
                                "net.fabricmc.fabric-loader" => {
                                    loader_tipo = Some("Fabric".to_string());
                                    loader_versao = versao;
                                }
                                "net.neoforged" => {
                                    loader_tipo = Some("NeoForge".to_string());
                                    loader_versao = versao;
                                }
                                "org.quiltmc.quilt-loader" => {
                                    loader_tipo = Some("Quilt".to_string());
                                    loader_versao = versao;
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        if versao_minecraft.trim().is_empty() {
            continue;
        }

        let caminho_jogo = detectar_caminho_jogo(&caminho_origem);
        resultados.push(InstanciaImportavelExterna {
            id_externo: format!("prism:{}", caminho_origem.to_string_lossy()),
            launcher: "prism".to_string(),
            nome,
            versao_minecraft,
            loader_type: loader_tipo,
            loader_version: loader_versao,
            icone: None,
            caminho_origem: caminho_origem.to_string_lossy().to_string(),
            caminho_jogo: caminho_jogo.to_string_lossy().to_string(),
        });
    }

    resultados
}

fn listar_instancias_modrinth_por_profile_json(
    pasta_base: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    let mut resultados = Vec::new();
    let entradas = match std::fs::read_dir(pasta_base) {
        Ok(valor) => valor,
        Err(_) => return resultados,
    };

    for entrada in entradas.flatten() {
        if !entrada.path().is_dir() {
            continue;
        }

        let caminho_origem = entrada.path();
        let caminho_profile = caminho_origem.join("profile.json");
        if !caminho_profile.exists() {
            continue;
        }

        let conteudo = match std::fs::read_to_string(&caminho_profile) {
            Ok(valor) => valor,
            Err(_) => continue,
        };
        let json = match serde_json::from_str::<serde_json::Value>(&conteudo) {
            Ok(valor) => valor,
            Err(_) => continue,
        };

        let nome = texto_json_caminho(&json, &["metadata", "name"])
            .or_else(|| texto_json_caminho(&json, &["name"]))
            .unwrap_or_else(|| entrada.file_name().to_string_lossy().to_string());

        let versao_minecraft = texto_json_caminho(&json, &["metadata", "game_version"])
            .or_else(|| texto_json_caminho(&json, &["game_version"]))
            .unwrap_or_default();
        if versao_minecraft.is_empty() {
            continue;
        }

        let loader_normalizado = detectar_loader_normalizado(
            texto_json_caminho(&json, &["metadata", "loader"])
                .or_else(|| texto_json_caminho(&json, &["loader"]))
                .as_deref(),
        );
        let loader_type = rotulo_loader(loader_normalizado.as_deref());
        let loader_version = texto_json_caminho(&json, &["metadata", "loader_version"])
            .or_else(|| texto_json_caminho(&json, &["loader_version"]));
        let icone = texto_json_caminho(&json, &["metadata", "icon_url"])
            .or_else(|| texto_json_caminho(&json, &["icon_url"]))
            .or_else(|| texto_json_caminho(&json, &["icon_path"]));

        let caminho_jogo = texto_json_caminho(&json, &["path"])
            .map(std::path::PathBuf::from)
            .filter(|c| c.exists() && c.is_dir())
            .unwrap_or_else(|| caminho_origem.clone());

        resultados.push(InstanciaImportavelExterna {
            id_externo: format!("modrinth:{}", caminho_origem.to_string_lossy()),
            launcher: "modrinth".to_string(),
            nome,
            versao_minecraft,
            loader_type,
            loader_version,
            icone,
            caminho_origem: caminho_origem.to_string_lossy().to_string(),
            caminho_jogo: caminho_jogo.to_string_lossy().to_string(),
        });
    }

    resultados
}

type RegistroInstanciaModrinth = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

fn montar_instancia_modrinth(
    pasta_base: &std::path::Path,
    registro: RegistroInstanciaModrinth,
) -> Option<InstanciaImportavelExterna> {
    let (caminho_perfil, nome_banco, versao_minecraft, mod_loader, mod_loader_version, icone) =
        registro;
    if versao_minecraft.trim().is_empty() {
        return None;
    }

    let caminho = std::path::PathBuf::from(caminho_perfil.trim());
    let caminho_origem = if caminho.is_absolute() {
        caminho
    } else {
        pasta_base.join(caminho)
    };

    if !caminho_origem.is_dir() {
        return None;
    }

    let nome = if nome_banco.trim().is_empty() {
        caminho_origem
            .file_name()
            .and_then(|nome| nome.to_str())
            .map(str::to_string)
            .unwrap_or_else(|| "Instância Modrinth".to_string())
    } else {
        nome_banco
    };
    let loader_normalizado = detectar_loader_normalizado(Some(&mod_loader));
    let loader_version = mod_loader_version
        .map(|versao| versao.trim().to_string())
        .filter(|versao| !versao.is_empty());

    Some(InstanciaImportavelExterna {
        id_externo: format!("modrinth:{}", caminho_origem.to_string_lossy()),
        launcher: "modrinth".to_string(),
        nome,
        versao_minecraft: versao_minecraft.trim().to_string(),
        loader_type: rotulo_loader(loader_normalizado.as_deref()),
        loader_version,
        icone,
        caminho_origem: caminho_origem.to_string_lossy().to_string(),
        caminho_jogo: detectar_caminho_jogo(&caminho_origem)
            .to_string_lossy()
            .to_string(),
    })
}

fn consultar_instancias_modrinth(
    conexao: &rusqlite::Connection,
    pasta_base: &std::path::Path,
    sql: &str,
) -> Option<Vec<InstanciaImportavelExterna>> {
    let mut consulta = conexao.prepare(sql).ok()?;
    let linhas = consulta
        .query_map([], |linha| {
            Ok((
                linha.get(0)?,
                linha.get(1)?,
                linha.get(2)?,
                linha.get(3)?,
                linha.get(4)?,
                linha.get(5)?,
            ))
        })
        .ok()?;

    Some(
        linhas
            .flatten()
            .filter_map(|registro| montar_instancia_modrinth(pasta_base, registro))
            .collect(),
    )
}

fn listar_instancias_modrinth_por_banco(
    pasta_base: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    let Some(pasta_app) = pasta_base.parent() else {
        return Vec::new();
    };
    let caminho_banco = pasta_app.join("app.db");
    if !caminho_banco.exists() {
        return Vec::new();
    }

    let conexao = match rusqlite::Connection::open_with_flags(
        caminho_banco,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        Ok(conexao) => conexao,
        Err(_) => return Vec::new(),
    };

    const CONSULTA_ATUAL: &str = "
        SELECT i.path, i.name, c.game_version, c.loader, c.loader_version, i.icon_path
        FROM instances i
        INNER JOIN instance_content_sets c ON c.id = i.applied_content_set_id
    ";
    if let Some(resultados) = consultar_instancias_modrinth(&conexao, pasta_base, CONSULTA_ATUAL) {
        return resultados;
    }

    const CONSULTA_LEGADA: &str = "
        SELECT path, name, game_version, mod_loader, mod_loader_version, NULL
        FROM profiles
    ";
    consultar_instancias_modrinth(&conexao, pasta_base, CONSULTA_LEGADA).unwrap_or_default()
}

fn listar_instancias_modrinth() -> Vec<InstanciaImportavelExterna> {
    let Some(base) = directories::BaseDirs::new() else {
        return Vec::new();
    };

    let dados = base.data_dir();
    let pastas_base = vec![
        dados.join("com.modrinth.theseus").join("profiles"),
        dados.join("ModrinthApp").join("profiles"),
        dados.join("theseus").join("profiles"),
    ];

    let mut resultados = Vec::new();
    for pasta_base in pastas_base {
        if !pasta_base.exists() {
            continue;
        }

        resultados.extend(listar_instancias_modrinth_por_profile_json(&pasta_base));
        resultados.extend(listar_instancias_modrinth_por_banco(&pasta_base));
    }

    resultados
}

fn extrair_loader_curseforge(
    base_mod_loader: &serde_json::Value,
    versao_minecraft: &str,
) -> (Option<String>, Option<String>) {
    let nome = texto_json_caminho(base_mod_loader, &["name"]).unwrap_or_default();
    let maven = texto_json_caminho(base_mod_loader, &["mavenVersionString"]).unwrap_or_default();
    let combinado = format!("{} {}", nome, maven);
    let loader_normalizado = detectar_loader_normalizado(Some(&combinado));
    let loader_type = rotulo_loader(loader_normalizado.as_deref());

    let mut loader_version = None;

    if let Some(parte_maven) = maven.split(':').next_back() {
        let texto = parte_maven.trim();
        if !texto.is_empty() {
            loader_version = Some(texto.to_string());
        }
    }

    if loader_version.is_none() && !nome.trim().is_empty() {
        let nome_lower = nome.to_lowercase();
        let prefixos = ["forge-", "fabric-", "fabric_loader-", "neoforge-", "quilt-"];
        for prefixo in prefixos {
            if nome_lower.starts_with(prefixo) {
                loader_version = Some(nome[prefixo.len()..].to_string());
                break;
            }
        }
    }

    if let Some(loader) = loader_normalizado {
        if loader == "forge" {
            if let Some(ref mut versao_loader) = loader_version {
                if !versao_loader.starts_with(&format!("{}-", versao_minecraft))
                    && !versao_loader.starts_with("1.")
                {
                    *versao_loader = format!("{}-{}", versao_minecraft, versao_loader);
                }
            }
        }
    }

    (loader_type, loader_version)
}

fn listar_instancias_curseforge() -> Vec<InstanciaImportavelExterna> {
    let Some(user_profile) = std::env::var("USERPROFILE").ok() else {
        return Vec::new();
    };

    let pastas_base = vec![
        std::path::PathBuf::from(&user_profile)
            .join("curseforge")
            .join("minecraft")
            .join("Instances"),
        std::path::PathBuf::from(&user_profile)
            .join("Documents")
            .join("Curse")
            .join("Minecraft")
            .join("Instances"),
    ];

    let mut resultados = Vec::new();

    for pasta_base in pastas_base {
        if !pasta_base.exists() {
            continue;
        }

        resultados.extend(listar_instancias_curseforge_em(&pasta_base));
    }

    resultados
}

fn listar_instancias_curseforge_em(
    pasta_base: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    let mut resultados = Vec::new();

    let entradas = match std::fs::read_dir(pasta_base) {
        Ok(valor) => valor,
        Err(_) => return resultados,
    };

    for entrada in entradas.flatten() {
        if !entrada.path().is_dir() {
            continue;
        }

        let caminho_origem = entrada.path();
        let caminho_instancia = caminho_origem.join("minecraftinstance.json");
        if !caminho_instancia.exists() {
            continue;
        }

        let conteudo = match std::fs::read_to_string(&caminho_instancia) {
            Ok(valor) => valor,
            Err(_) => continue,
        };
        let json = match serde_json::from_str::<serde_json::Value>(&conteudo) {
            Ok(valor) => valor,
            Err(_) => continue,
        };

        let nome = texto_json_caminho(&json, &["name"])
            .unwrap_or_else(|| entrada.file_name().to_string_lossy().to_string());
        let versao_minecraft = texto_json_caminho(&json, &["gameVersion"])
            .or_else(|| texto_json_caminho(&json, &["minecraftVersion"]))
            .unwrap_or_default();
        if versao_minecraft.is_empty() {
            continue;
        }

        let (loader_type, loader_version) =
            extrair_loader_curseforge(&json["baseModLoader"], &versao_minecraft);
        let caminho_jogo = detectar_caminho_jogo(&caminho_origem);

        resultados.push(InstanciaImportavelExterna {
            id_externo: format!("curseforge:{}", caminho_origem.to_string_lossy()),
            launcher: "curseforge".to_string(),
            nome,
            versao_minecraft,
            loader_type,
            loader_version,
            icone: texto_json_caminho(&json, &["profileImagePath"])
                .or_else(|| texto_json_caminho(&json, &["installedModpack", "thumbnailUrl"]))
                .or_else(|| texto_json_caminho(&json, &["thumbnailUrl"])),
            caminho_origem: caminho_origem.to_string_lossy().to_string(),
            caminho_jogo: caminho_jogo.to_string_lossy().to_string(),
        });
    }

    resultados
}

fn listar_instancias_em_pasta_apontada(
    pasta_apontada: &std::path::Path,
) -> Vec<InstanciaImportavelExterna> {
    let candidatos = [
        pasta_apontada.to_path_buf(),
        pasta_apontada.join("instances"),
        pasta_apontada.join("Instances"),
        pasta_apontada.join("profiles"),
        pasta_apontada.join("minecraft").join("Instances"),
        pasta_apontada.join("Minecraft").join("Instances"),
    ];
    let mut pastas_vistas = std::collections::HashSet::new();
    let mut resultados = Vec::new();

    for pasta_base in candidatos {
        if !pasta_base.is_dir() {
            continue;
        }

        let chave = pasta_base.to_string_lossy().to_lowercase();
        if !pastas_vistas.insert(chave) {
            continue;
        }

        resultados.extend(listar_instancias_prism_em(&pasta_base));
        resultados.extend(listar_instancias_modrinth_por_profile_json(&pasta_base));
        resultados.extend(listar_instancias_modrinth_por_banco(&pasta_base));
        resultados.extend(listar_instancias_curseforge_em(&pasta_base));
    }

    resultados
}

#[tauri::command]
pub(crate) fn listar_instancias_importaveis(
    caminhos_adicionais: Option<Vec<String>>,
) -> Result<Vec<InstanciaImportavelExterna>, String> {
    let mut resultados = Vec::new();
    resultados.extend(listar_instancias_prism());
    resultados.extend(listar_instancias_modrinth());
    resultados.extend(listar_instancias_curseforge());

    for caminho in caminhos_adicionais.unwrap_or_default() {
        let pasta_apontada = std::path::PathBuf::from(caminho.trim());
        if pasta_apontada.is_dir() {
            resultados.extend(listar_instancias_em_pasta_apontada(&pasta_apontada));
        }
    }

    let mut caminhos_vistos = std::collections::HashSet::new();
    resultados
        .retain(|instancia| caminhos_vistos.insert(instancia.caminho_origem.trim().to_lowercase()));

    resultados.sort_by(|a, b| {
        a.launcher
            .cmp(&b.launcher)
            .then_with(|| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()))
    });

    Ok(resultados)
}

fn preparar_arquivos_diretorio(
    origem: &std::path::Path,
    destino: &std::path::Path,
) -> Result<Vec<(std::path::PathBuf, std::path::PathBuf)>, String> {
    if !origem.exists() || !origem.is_dir() {
        return Ok(Vec::new());
    }

    std::fs::create_dir_all(destino).map_err(|e| format!("Erro ao criar pasta destino: {}", e))?;
    let entradas =
        std::fs::read_dir(origem).map_err(|e| format!("Erro ao ler pasta origem: {}", e))?;
    let mut arquivos = Vec::new();

    for entrada in entradas.flatten() {
        let tipo = match entrada.file_type() {
            Ok(valor) => valor,
            Err(_) => continue,
        };
        if tipo.is_symlink() {
            continue;
        }

        let origem_item = entrada.path();
        let destino_item = destino.join(entrada.file_name());
        if tipo.is_dir() {
            arquivos.extend(preparar_arquivos_diretorio(&origem_item, &destino_item)?);
        } else if tipo.is_file() {
            arquivos.push((origem_item, destino_item));
        }
    }

    Ok(arquivos)
}

fn preparar_arquivos_instancia_importada(
    caminho_jogo_origem: &std::path::Path,
    pasta_instancia_destino: &std::path::Path,
) -> Result<Vec<(std::path::PathBuf, std::path::PathBuf)>, String> {
    if !caminho_jogo_origem.exists() || !caminho_jogo_origem.is_dir() {
        return Err("Pasta do jogo da instância importada não encontrada.".to_string());
    }

    let mut arquivos = Vec::new();
    for pasta in PASTAS_CONTEUDO_IMPORTADO {
        arquivos.extend(preparar_arquivos_diretorio(
            &caminho_jogo_origem.join(pasta),
            &pasta_instancia_destino.join(pasta),
        )?);
    }

    for arquivo in ARQUIVOS_CONTEUDO_IMPORTADO {
        let origem = caminho_jogo_origem.join(arquivo);
        if origem.is_file() {
            arquivos.push((origem, pasta_instancia_destino.join(arquivo)));
        }
    }

    Ok(arquivos)
}

fn copiar_arquivo(origem: &std::path::Path, destino: &std::path::Path) -> Result<(), String> {
    if !origem.is_file() {
        return Err(format!(
            "Arquivo de origem não encontrado durante a importação: {}",
            origem.display()
        ));
    }

    if let Some(pai) = destino.parent() {
        std::fs::create_dir_all(pai).map_err(|e| format!("Erro ao criar pasta destino: {}", e))?;
    }
    std::fs::copy(origem, destino).map_err(|e| format!("Erro ao copiar arquivo: {}", e))?;
    Ok(())
}

fn calcular_porcentagem(arquivos_copiados: usize, total_arquivos: usize) -> u8 {
    if total_arquivos == 0 {
        return 0;
    }

    arquivos_copiados
        .min(total_arquivos)
        .saturating_mul(100)
        .checked_div(total_arquivos)
        .unwrap_or(0) as u8
}

fn emitir_progresso_importacao(
    app: &tauri::AppHandle,
    id_externo: &str,
    etapa: &str,
    arquivos_copiados: usize,
    total_arquivos: usize,
) {
    let porcentagem = if etapa == "concluida" {
        100
    } else {
        calcular_porcentagem(arquivos_copiados, total_arquivos)
    };
    let _ = app.emit(
        EVENTO_PROGRESSO_IMPORTACAO_INSTANCIA,
        ProgressoImportacaoInstancia {
            id_externo: id_externo.to_string(),
            etapa: etapa.to_string(),
            arquivos_copiados,
            total_arquivos,
            porcentagem,
        },
    );
}

fn copiar_conteudo_instancia_importada(
    caminho_jogo_origem: &std::path::Path,
    pasta_instancia_destino: &std::path::Path,
    mut ao_progresso: impl FnMut(usize, usize),
) -> Result<usize, String> {
    let arquivos =
        preparar_arquivos_instancia_importada(caminho_jogo_origem, pasta_instancia_destino)?;
    let total_arquivos = arquivos.len();
    ao_progresso(0, total_arquivos);

    for (indice, (origem, destino)) in arquivos.into_iter().enumerate() {
        copiar_arquivo(&origem, &destino)?;
        ao_progresso(indice + 1, total_arquivos);
    }

    Ok(total_arquivos)
}

fn gerar_nome_instancia_unico(state: &LauncherState, nome_base: &str) -> String {
    let nome_base = if nome_base.trim().is_empty() {
        "Instância importada".to_string()
    } else {
        nome_base.trim().to_string()
    };

    let mut ids_existentes: std::collections::HashSet<String> = state
        .get_instances()
        .unwrap_or_default()
        .into_iter()
        .map(|instancia| instancia.id)
        .collect();

    if let Ok(entradas) = state
        .caminho_instancias()
        .and_then(|caminho| std::fs::read_dir(caminho).map_err(|erro| erro.to_string()))
    {
        for entrada in entradas.flatten() {
            if entrada.path().is_dir() {
                ids_existentes.insert(entrada.file_name().to_string_lossy().to_string());
            }
        }
    }

    let mut nome_tentativa = nome_base.clone();
    let mut contador = 2;
    loop {
        let id_tentativa =
            super::instancias_basicas::normalizar_nome_pasta_instancia(&nome_tentativa);
        if !ids_existentes.contains(&id_tentativa) {
            return nome_tentativa;
        }
        nome_tentativa = format!("{} ({})", nome_base, contador);
        contador += 1;
    }
}

async fn resolver_versao_loader_importacao(
    loader_normalizado: &str,
    versao_minecraft: &str,
    versao_sugerida: Option<&str>,
) -> Result<String, String> {
    if loader_normalizado == "fabric" {
        let versoes_compativeis = buscar_versoes_fabric_compativeis(versao_minecraft).await?;
        if versoes_compativeis.is_empty() {
            return Err(format!(
                "Nenhuma versão do Fabric disponível para Minecraft {}.",
                versao_minecraft
            ));
        }

        if let Some(versao) = escolher_versao_fabric_compativel(
            &versoes_compativeis,
            versao_sugerida,
            versao_minecraft,
        ) {
            return Ok(versao);
        }

        return Ok(versoes_compativeis[0].clone());
    }

    if let Some(versao) = versao_sugerida.map(|v| v.trim()).filter(|v| !v.is_empty()) {
        if loader_normalizado == "forge" {
            if versao.starts_with(&format!("{}-", versao_minecraft)) {
                return Ok(versao.to_string());
            }
            if versao.chars().next().is_some_and(|c| c.is_ascii_digit())
                && !versao.starts_with("1.")
            {
                return Ok(format!("{}-{}", versao_minecraft, versao));
            }
        }
        return Ok(versao.to_string());
    }

    let resposta = super::instancias_criacao::get_loader_versions(
        loader_normalizado.to_string(),
        Some(versao_minecraft.to_string()),
    )
    .await?;
    let versoes: Vec<String> = resposta.versions.into_iter().map(|v| v.version).collect();
    if loader_normalizado == "forge" {
        if let Some(versao) = versoes
            .iter()
            .find(|versao| versao.starts_with(&format!("{}-", versao_minecraft)))
            .cloned()
        {
            return Ok(versao);
        }
    }

    versoes.into_iter().next().ok_or_else(|| {
        format!(
            "Nenhuma versão disponível para loader {}.",
            loader_normalizado
        )
    })
}

async fn buscar_versoes_fabric_compativeis(versao_minecraft: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP do Fabric: {}", e))?;

    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}",
        versao_minecraft
    );
    let response = client.get(&url).send().await.map_err(|e| {
        format!(
            "Erro ao buscar versões do Fabric para {}: {}",
            versao_minecraft, e
        )
    })?;

    if !response.status().is_success() {
        return Err(format!(
            "API do Fabric retornou erro ({}) para Minecraft {}.",
            response.status(),
            versao_minecraft
        ));
    }

    let payload: Vec<serde_json::Value> = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear versões do Fabric: {}", e))?;

    let mut versoes = Vec::new();
    let mut vistos = std::collections::HashSet::new();

    for item in payload {
        if let Some(versao_loader) = item["loader"]["version"].as_str() {
            let versao_limpa = versao_loader.trim();
            if !versao_limpa.is_empty() && vistos.insert(versao_limpa.to_string()) {
                versoes.push(versao_limpa.to_string());
            }
        }
    }

    Ok(versoes)
}

fn escolher_versao_fabric_compativel(
    versoes_compativeis: &[String],
    versao_sugerida: Option<&str>,
    versao_minecraft: &str,
) -> Option<String> {
    let sugestao = versao_sugerida
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())?;
    let candidatos = gerar_candidatos_versao_fabric(sugestao, versao_minecraft);

    for candidato in candidatos {
        if let Some(versao) = versoes_compativeis
            .iter()
            .find(|v| v.eq_ignore_ascii_case(&candidato))
        {
            return Some(versao.clone());
        }
    }

    let sugestao_lower = sugestao.to_lowercase();
    let mut versoes_ordenadas = versoes_compativeis.to_vec();
    versoes_ordenadas.sort_by_key(|v| std::cmp::Reverse(v.len()));

    versoes_ordenadas
        .into_iter()
        .find(|v| sugestao_lower.contains(&v.to_lowercase()))
}

fn gerar_candidatos_versao_fabric(sugestao: &str, versao_minecraft: &str) -> Vec<String> {
    let mut candidatos = Vec::new();

    fn adicionar_candidato(candidatos: &mut Vec<String>, valor: &str) {
        let valor_limpo = valor.trim();
        if valor_limpo.is_empty() {
            return;
        }
        if candidatos
            .iter()
            .any(|existente: &String| existente.eq_ignore_ascii_case(valor_limpo))
        {
            return;
        }
        candidatos.push(valor_limpo.to_string());
    }

    adicionar_candidato(&mut candidatos, sugestao);

    if let Some(ultimo) = sugestao.rsplit(':').next() {
        adicionar_candidato(&mut candidatos, ultimo);
    }

    let sugestao_lower = sugestao.to_lowercase();
    let prefixos = ["fabric-loader-", "fabric_loader-", "fabric-", "loader-"];
    for prefixo in prefixos {
        if sugestao_lower.starts_with(prefixo) && sugestao.len() > prefixo.len() {
            adicionar_candidato(&mut candidatos, &sugestao[prefixo.len()..]);
        }
    }

    let marcador_plus = format!("+{}", versao_minecraft);
    let marcador_hifen = format!("-{}", versao_minecraft);
    let snapshot = candidatos.clone();
    for candidato in snapshot {
        if let Some(base) = candidato.strip_suffix(&marcador_plus) {
            adicionar_candidato(&mut candidatos, base);
        }
        if let Some(base) = candidato.strip_suffix(&marcador_hifen) {
            adicionar_candidato(&mut candidatos, base);
        }
        if let Some((base, _)) = candidato.split_once('+') {
            adicionar_candidato(&mut candidatos, base);
        }
    }

    candidatos
}

async fn criar_instancia_base_importada(
    state: &LauncherState,
    nome_instancia: &str,
    versao_minecraft: &str,
    loader_type: Option<&str>,
    loader_version: Option<&str>,
    icone_origem: Option<&str>,
    baixar_arquivos_jogo: bool,
) -> Result<Instance, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar manifesto Minecraft: {}", e))?;
    let manifest = res
        .json::<VersionManifest>()
        .await
        .map_err(|e| format!("Erro ao ler manifesto Minecraft: {}", e))?;

    let version_entry = manifest
        .versions
        .iter()
        .find(|v| v.id == versao_minecraft)
        .ok_or_else(|| format!("Versão Minecraft '{}' não encontrada.", versao_minecraft))?;

    let res = client
        .get(&version_entry.url)
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar detalhes da versão: {}", e))?;
    let details = res
        .json::<VersionDetail>()
        .await
        .map_err(|e| format!("Erro ao ler detalhes da versão: {}", e))?;

    let id = super::instancias_basicas::normalizar_nome_pasta_instancia(nome_instancia);
    let instance_path = caminho_instancia_por_id(state, &id)?;
    if !instance_path.exists() {
        std::fs::create_dir_all(&instance_path).map_err(|e| e.to_string())?;
    }

    let loader_normalizado = detectar_loader_normalizado(loader_type);
    let loader_exige_arquivos = matches!(loader_normalizado.as_deref(), Some("forge" | "neoforge"));
    if baixar_arquivos_jogo || loader_exige_arquivos {
        super::instancias_criacao::download_instance_files(&instance_path, &details).await?;
    }

    let version_manifest_path = instance_path.join("version_manifest.json");
    let version_content = serde_json::to_string_pretty(&details).map_err(|e| e.to_string())?;
    std::fs::write(&version_manifest_path, &version_content).map_err(|e| e.to_string())?;

    let (loader_type_salvo, loader_version_final, mc_type) = match loader_normalizado.as_deref() {
        Some("forge") => {
            let versao_loader =
                resolver_versao_loader_importacao("forge", versao_minecraft, loader_version)
                    .await?;
            super::instancias_criacao::install_forge_loader(
                &instance_path,
                versao_minecraft,
                &versao_loader,
            )
            .await?;
            (
                Some("Forge".to_string()),
                Some(versao_loader),
                "forge".to_string(),
            )
        }
        Some("fabric") => {
            let versao_loader =
                resolver_versao_loader_importacao("fabric", versao_minecraft, loader_version)
                    .await?;
            super::instancias_criacao::install_fabric_loader(
                &instance_path,
                versao_minecraft,
                &versao_loader,
            )
            .await?;
            (
                Some("Fabric".to_string()),
                Some(versao_loader),
                "fabric".to_string(),
            )
        }
        Some("neoforge") => {
            let versao_loader =
                resolver_versao_loader_importacao("neoforge", versao_minecraft, loader_version)
                    .await?;
            super::instancias_criacao::install_neoforge_loader(
                &instance_path,
                versao_minecraft,
                &versao_loader,
            )
            .await?;
            (
                Some("NeoForge".to_string()),
                Some(versao_loader),
                "neoforge".to_string(),
            )
        }
        Some("quilt") => {
            return Err("Instâncias com Quilt ainda não são suportadas no importador.".to_string());
        }
        Some("vanilla") | None => (Some("Vanilla".to_string()), None, "vanilla".to_string()),
        Some(outro) => {
            return Err(format!(
                "Loader '{}' ainda não é suportado no importador.",
                outro
            ))
        }
    };

    let icone = preparar_icone_importado(icone_origem)
        .unwrap_or_else(|| format!("https://api.dicebear.com/9.x/shapes/svg?seed={}", id));
    let instance = Instance {
        id: id.clone(),
        name: nome_instancia.to_string(),
        version: versao_minecraft.to_string(),
        mc_type,
        loader_type: loader_type_salvo,
        loader_version: loader_version_final,
        icon: Some(icone),
        created: chrono::Utc::now().to_rfc3339(),
        last_played: None,
        tempo_total_jogado_segundos: 0,
        sessao_iniciada_em: None,
        path: instance_path.clone(),
        java_args: None,
        mc_args: None,
        memory: None,
        width: None,
        height: None,
    };

    let config_path = instance_path.join("instance.json");
    let content = serde_json::to_string_pretty(&instance).map_err(|e| e.to_string())?;
    std::fs::write(config_path, content).map_err(|e| e.to_string())?;

    let version_manifest_path = instance_path.join("version_manifest.json");
    let version_content = serde_json::to_string_pretty(&details).map_err(|e| e.to_string())?;
    std::fs::write(version_manifest_path, version_content).map_err(|e| e.to_string())?;

    Ok(instance)
}

fn preparar_icone_importado(icone_origem: Option<&str>) -> Option<String> {
    let valor = icone_origem?.trim();
    if valor.is_empty() {
        return None;
    }
    if valor.starts_with("data:") || valor.starts_with("https://") {
        return Some(valor.to_string());
    }

    let caminho = std::path::Path::new(valor);
    let metadados = std::fs::metadata(caminho).ok()?;
    if !metadados.is_file() || metadados.len() > 10 * 1024 * 1024 {
        return None;
    }

    let mime = match caminho
        .extension()
        .and_then(|extensao| extensao.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    };
    let bytes = std::fs::read(caminho).ok()?;
    use base64::Engine as _;
    let conteudo = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", mime, conteudo))
}

fn chave_nome_instancia(nome: &str) -> String {
    super::instancias_basicas::normalizar_nome_pasta_instancia(nome)
}

pub(crate) fn atualizar_icones_instancias_modrinth_existentes(
    state: &LauncherState,
) -> Result<usize, String> {
    let instancias_com_icone_generico = state
        .get_instances()?
        .into_iter()
        .filter(|instancia| {
            instancia
                .icon
                .as_deref()
                .map(|icone| icone.trim().is_empty() || icone.contains("api.dicebear.com"))
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();

    if instancias_com_icone_generico.is_empty() {
        return Ok(0);
    }

    let icones_por_nome = listar_instancias_modrinth()
        .into_iter()
        .filter_map(|instancia| {
            preparar_icone_importado(instancia.icone.as_deref())
                .map(|icone| (chave_nome_instancia(&instancia.nome), icone))
        })
        .collect::<std::collections::HashMap<_, _>>();

    if icones_por_nome.is_empty() {
        return Ok(0);
    }

    let mut quantidade_atualizada = 0;
    for mut instancia in instancias_com_icone_generico {
        let Some(icone) = icones_por_nome.get(&chave_nome_instancia(&instancia.name)) else {
            continue;
        };

        instancia.icon = Some(icone.clone());
        let caminho_config = instancia.path.join("instance.json");
        let conteudo = serde_json::to_string_pretty(&instancia).map_err(|e| {
            format!(
                "Erro ao preparar capa da instância {}: {}",
                instancia.name, e
            )
        })?;
        std::fs::write(&caminho_config, conteudo).map_err(|e| {
            format!(
                "Erro ao atualizar capa da instância {}: {}",
                instancia.name, e
            )
        })?;
        quantidade_atualizada += 1;
    }

    Ok(quantidade_atualizada)
}

#[tauri::command]
pub(crate) async fn importar_instancias_externas(
    instancias: Vec<InstanciaImportavelExterna>,
    app: tauri::AppHandle,
    state: State<'_, LauncherState>,
) -> Result<Vec<ResultadoImportacaoInstancia>, String> {
    if instancias.is_empty() {
        return Ok(Vec::new());
    }

    let mut resultados = Vec::new();

    for instancia in instancias {
        emitir_progresso_importacao(&app, &instancia.id_externo, "preparando", 0, 0);
        let nome_unico = gerar_nome_instancia_unico(&state, &instancia.nome);
        let resultado = match criar_instancia_base_importada(
            &state,
            &nome_unico,
            instancia.versao_minecraft.trim(),
            instancia.loader_type.as_deref(),
            instancia.loader_version.as_deref(),
            instancia.icone.as_deref(),
            true,
        )
        .await
        {
            Ok(instancia_criada) => {
                let caminho_jogo = std::path::PathBuf::from(instancia.caminho_jogo.trim());
                let caminho_destino = instancia_criada.path.clone();
                let id_externo = instancia.id_externo.clone();
                let app_copia = app.clone();
                let mensagem_copia = tauri::async_runtime::spawn_blocking(move || {
                    let mut ultima_porcentagem = None;
                    copiar_conteudo_instancia_importada(
                        &caminho_jogo,
                        &caminho_destino,
                        |arquivos_copiados, total_arquivos| {
                            let porcentagem =
                                calcular_porcentagem(arquivos_copiados, total_arquivos);
                            if ultima_porcentagem == Some(porcentagem)
                                && arquivos_copiados < total_arquivos
                            {
                                return;
                            }
                            ultima_porcentagem = Some(porcentagem);
                            emitir_progresso_importacao(
                                &app_copia,
                                &id_externo,
                                "copiando",
                                arquivos_copiados,
                                total_arquivos,
                            );
                        },
                    )
                })
                .await
                .map_err(|e| format!("Falha interna ao copiar a instância importada: {}", e))?;
                match mensagem_copia {
                    Err(erro_copia) => ResultadoImportacaoInstancia {
                        id_externo: instancia.id_externo.clone(),
                        launcher: instancia.launcher.clone(),
                        nome_origem: instancia.nome.clone(),
                        sucesso: true,
                        instancia_id: Some(instancia_criada.id.clone()),
                        mensagem: format!(
                            "Instância importada, mas houve falha ao copiar parte dos arquivos: {}",
                            erro_copia
                        ),
                    },
                    Ok(total_arquivos) => {
                        emitir_progresso_importacao(
                            &app,
                            &instancia.id_externo,
                            "concluida",
                            total_arquivos,
                            total_arquivos,
                        );
                        ResultadoImportacaoInstancia {
                            id_externo: instancia.id_externo.clone(),
                            launcher: instancia.launcher.clone(),
                            nome_origem: instancia.nome.clone(),
                            sucesso: true,
                            instancia_id: Some(instancia_criada.id.clone()),
                            mensagem: "Instância importada com sucesso.".to_string(),
                        }
                    }
                }
            }
            Err(erro) => ResultadoImportacaoInstancia {
                id_externo: instancia.id_externo.clone(),
                launcher: instancia.launcher.clone(),
                nome_origem: instancia.nome.clone(),
                sucesso: false,
                instancia_id: None,
                mensagem: erro,
            },
        };
        resultados.push(resultado);
    }

    Ok(resultados)
}

// ===== EXPORTAÇÃO / IMPORTAÇÃO DE INSTÂNCIAS (ZIP) =====

/// Estrutura do manifesto de exportação do Dome Launcher
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManifestoExportacao {
    pub dome_launcher_version: String,
    pub nome: String,
    pub versao_minecraft: String,
    pub mc_type: String,
    pub loader_type: Option<String>,
    pub loader_version: Option<String>,
    pub exportado_em: String,
    pub icon: Option<String>,
}

/// Resultado da exportação
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoExportacao {
    pub sucesso: bool,
    pub caminho_arquivo: Option<String>,
    pub mensagem: String,
}

/// Resultado da importação por arquivo
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultadoImportacaoArquivo {
    pub sucesso: bool,
    pub instancia_id: Option<String>,
    pub mensagem: String,
}

/// Adiciona diretório inteiro ao zip recursivamente
fn adicionar_diretorio_ao_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    caminho: &std::path::Path,
    prefixo_no_zip: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    if !caminho.exists() || !caminho.is_dir() {
        return Ok(());
    }

    let entradas = std::fs::read_dir(caminho)
        .map_err(|e| format!("Erro ao ler diretório {}: {}", caminho.display(), e))?;

    for entrada in entradas.flatten() {
        let tipo = match entrada.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if tipo.is_symlink() {
            continue;
        }

        let nome = entrada.file_name().to_string_lossy().to_string();
        let caminho_no_zip = if prefixo_no_zip.is_empty() {
            nome.clone()
        } else {
            format!("{}/{}", prefixo_no_zip, nome)
        };

        if tipo.is_dir() {
            adicionar_diretorio_ao_zip(zip, &entrada.path(), &caminho_no_zip, options)?;
        } else if tipo.is_file() {
            // Se o jogo estiver aberto, alguns arquivos podem estar com lock temporário.
            // Ignoramos arquivos inacessíveis sem abortar a exportação do pacote todo.
            let dados = match std::fs::read(entrada.path()) {
                Ok(bytes) => bytes,
                Err(e) => {
                    eprintln!(
                        "[Exportação] Aviso: ignorando arquivo inacessível '{}': {}",
                        entrada.path().display(),
                        e
                    );
                    continue;
                }
            };
            if let Err(e) = zip.start_file(&caminho_no_zip, options) {
                eprintln!(
                    "[Exportação] Aviso: erro ao criar '{}' no zip: {}",
                    caminho_no_zip, e
                );
                continue;
            }
            use std::io::Write;
            if let Err(e) = zip.write_all(&dados) {
                eprintln!(
                    "[Exportação] Aviso: erro ao escrever '{}' no zip: {}",
                    caminho_no_zip, e
                );
                continue;
            }
        }
    }

    Ok(())
}

fn resolver_pasta_destino_exportacao(destino: Option<&str>) -> std::path::PathBuf {
    if let Some(dest) = destino {
        return std::path::PathBuf::from(dest);
    }

    std::env::var("USERPROFILE")
        .map(|perfil| std::path::PathBuf::from(perfil).join("Downloads"))
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
}

fn exportar_instancia_interno(
    state: &LauncherState,
    instance_id: &str,
    destino: Option<&str>,
    incluir_saves: bool,
) -> Result<ResultadoExportacao, String> {
    let instancia = obter_instancia_por_id(state, instance_id)?;
    let pasta_destino = resolver_pasta_destino_exportacao(destino);

    if !pasta_destino.exists() {
        std::fs::create_dir_all(&pasta_destino)
            .map_err(|e| format!("Erro ao criar pasta de destino: {}", e))?;
    }

    // Nome sanitizado para arquivo
    let nome_arquivo = format!(
        "{}.dome",
        instancia
            .name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
            .collect::<String>()
            .trim()
            .replace(' ', "_")
    );

    let caminho_zip = pasta_destino.join(&nome_arquivo);

    // Criar manifesto
    let manifesto = ManifestoExportacao {
        dome_launcher_version: "1.0".to_string(),
        nome: instancia.name.clone(),
        versao_minecraft: instancia.version.clone(),
        mc_type: instancia.mc_type.clone(),
        loader_type: instancia.loader_type.clone(),
        loader_version: instancia.loader_version.clone(),
        exportado_em: chrono::Utc::now().to_rfc3339(),
        icon: instancia.icon.clone(),
    };

    // Criar o zip
    let arquivo_zip = std::fs::File::create(&caminho_zip)
        .map_err(|e| format!("Erro ao criar arquivo zip: {}", e))?;
    let mut zip = zip::ZipWriter::new(arquivo_zip);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Adicionar manifesto
    let manifesto_json = serde_json::to_string_pretty(&manifesto)
        .map_err(|e| format!("Erro ao serializar manifesto: {}", e))?;
    zip.start_file("dome_manifest.json", options)
        .map_err(|e| format!("Erro ao criar manifesto no zip: {}", e))?;
    use std::io::Write;
    zip.write_all(manifesto_json.as_bytes())
        .map_err(|e| format!("Erro ao escrever manifesto: {}", e))?;

    // Adicionar instance.json original
    let instance_json_path = instancia.path.join("instance.json");
    if instance_json_path.exists() {
        let dados = std::fs::read(&instance_json_path)
            .map_err(|e| format!("Erro ao ler instance.json: {}", e))?;
        zip.start_file("instance.json", options)
            .map_err(|e| format!("Erro ao adicionar instance.json: {}", e))?;
        zip.write_all(&dados)
            .map_err(|e| format!("Erro ao escrever instance.json: {}", e))?;
    }

    // Pastas do jogo para incluir
    let mut pastas = vec![
        "mods",
        "resourcepacks",
        "shaderpacks",
        "config",
        "defaultconfigs",
        "kubejs",
        "scripts",
    ];
    if incluir_saves {
        pastas.push("saves");
    }
    for pasta in pastas {
        let caminho_pasta = instancia.path.join(pasta);
        adicionar_diretorio_ao_zip(&mut zip, &caminho_pasta, pasta, options)?;
    }

    // Arquivos avulsos
    let arquivos_avulsos = [
        "options.txt",
        "optionsof.txt",
        "optionsshaders.txt",
        "servers.dat",
    ];
    for arquivo in arquivos_avulsos {
        let caminho = instancia.path.join(arquivo);
        if caminho.exists() && caminho.is_file() {
            if let Ok(dados) = std::fs::read(&caminho) {
                if zip.start_file(arquivo, options).is_ok() {
                    use std::io::Write;
                    let _ = zip.write_all(&dados);
                }
            }
        }
    }

    zip.finish()
        .map_err(|e| format!("Erro ao finalizar arquivo zip: {}", e))?;

    Ok(ResultadoExportacao {
        sucesso: true,
        caminho_arquivo: Some(caminho_zip.to_string_lossy().to_string()),
        mensagem: format!("Instância exportada como {}", nome_arquivo),
    })
}

#[tauri::command]
pub(crate) async fn exportar_instancia(
    instance_id: String,
    destino: Option<String>,
    state: State<'_, LauncherState>,
) -> Result<ResultadoExportacao, String> {
    exportar_instancia_interno(&state, &instance_id, destino.as_deref(), true)
}

#[tauri::command]
pub(crate) async fn importar_instancia_arquivo(
    caminho_arquivo: String,
    state: State<'_, LauncherState>,
) -> Result<ResultadoImportacaoArquivo, String> {
    importar_instancia_em_estado(caminho_arquivo, &state).await
}

pub(crate) async fn importar_instancia_em_estado(
    caminho_arquivo: String,
    state: &LauncherState,
) -> Result<ResultadoImportacaoArquivo, String> {
    importar_instancia_em_estado_com_opcoes(caminho_arquivo, state, true).await
}

pub(crate) async fn importar_instancia_social_em_estado(
    caminho_arquivo: String,
    state: &LauncherState,
) -> Result<ResultadoImportacaoArquivo, String> {
    importar_instancia_em_estado_com_opcoes(caminho_arquivo, state, false).await
}

async fn importar_instancia_em_estado_com_opcoes(
    caminho_arquivo: String,
    state: &LauncherState,
    baixar_arquivos_jogo: bool,
) -> Result<ResultadoImportacaoArquivo, String> {
    let caminho = std::path::PathBuf::from(caminho_arquivo.trim());
    if !caminho.exists() {
        return Err("Arquivo não encontrado.".to_string());
    }

    let arquivo =
        std::fs::File::open(&caminho).map_err(|e| format!("Erro ao abrir arquivo: {}", e))?;
    let mut zip =
        zip::ZipArchive::new(arquivo).map_err(|e| format!("Erro ao ler arquivo zip: {}", e))?;

    let caminho_validacao = caminho.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::comandos::social_launcher::pacotes_sociais::validar_pacote(&caminho_validacao)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Tentar ler o manifesto do Dome Launcher
    let manifesto: Option<ManifestoExportacao> = {
        match zip.by_name("dome_manifest.json") {
            Ok(mut entry) => {
                let mut conteudo = String::new();
                use std::io::Read;
                entry.read_to_string(&mut conteudo).ok();
                serde_json::from_str(&conteudo).ok()
            }
            Err(_) => None,
        }
    };

    // Se não tiver manifesto, tentar instance.json (import de outro launcher)
    let (nome, versao_mc, _mc_type, loader_type, loader_version) = if let Some(ref m) = manifesto {
        (
            m.nome.clone(),
            m.versao_minecraft.clone(),
            m.mc_type.clone(),
            m.loader_type.clone(),
            m.loader_version.clone(),
        )
    } else {
        // Tentar ler instance.json
        match zip.by_name("instance.json") {
            Ok(mut entry) => {
                let mut conteudo = String::new();
                use std::io::Read;
                entry.read_to_string(&mut conteudo).ok();
                match serde_json::from_str::<serde_json::Value>(&conteudo) {
                    Ok(json) => {
                        let nome = json["name"].as_str().unwrap_or("Importada").to_string();
                        let versao = json["version"].as_str().unwrap_or("").to_string();
                        let mc_type = json["mcType"]
                            .as_str()
                            .or(json["mc_type"].as_str())
                            .unwrap_or("vanilla")
                            .to_string();
                        let loader = json["loaderType"]
                            .as_str()
                            .or(json["loader_type"].as_str())
                            .map(String::from);
                        let loader_v = json["loaderVersion"]
                            .as_str()
                            .or(json["loader_version"].as_str())
                            .map(String::from);
                        (nome, versao, mc_type, loader, loader_v)
                    }
                    Err(_) => {
                        return Err(
                            "Arquivo zip inválido: não contém dome_manifest.json nem instance.json válido."
                                .to_string(),
                        )
                    }
                }
            }
            Err(_) => {
                return Err(
                    "Arquivo zip inválido: não contém dome_manifest.json nem instance.json."
                        .to_string(),
                )
            }
        }
    };

    if versao_mc.is_empty() {
        return Err("Versão do Minecraft não encontrada no arquivo.".to_string());
    }

    // Criar instância base
    let nome_unico = gerar_nome_instancia_unico(state, &nome);
    let instancia_criada = criar_instancia_base_importada(
        state,
        &nome_unico,
        &versao_mc,
        loader_type.as_deref(),
        loader_version.as_deref(),
        manifesto.as_ref().and_then(|dados| dados.icon.as_deref()),
        baixar_arquivos_jogo,
    )
    .await?;

    let pasta_extracao = instancia_criada.path.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // Extrair arquivos do zip para a pasta da instância
        // Reabrir o zip para extrair (o ZipArchive anterior foi consumido parcialmente)
        let arquivo =
            std::fs::File::open(&caminho).map_err(|e| format!("Erro ao reabrir arquivo: {}", e))?;
        let mut zip = zip::ZipArchive::new(arquivo)
            .map_err(|e| format!("Erro ao reler arquivo zip: {}", e))?;

        // Itens que devemos extrair (ignorando manifesto e instance.json pois já usamos)
        for i in 0..zip.len() {
            let mut entry = match zip.by_index(i) {
                Ok(e) => e,
                Err(_) => continue,
            };

            let nome_entrada = match entry.enclosed_name() {
                Some(n) => n.to_path_buf(),
                None => continue,
            };

            let nome_str = nome_entrada.to_string_lossy().to_string();
            // Pular manifesto e instance.json (já processados)
            if nome_str == "dome_manifest.json" || nome_str == "instance.json" {
                continue;
            }

            let destino = pasta_extracao.join(&nome_entrada);

            if entry.is_dir() {
                std::fs::create_dir_all(&destino).ok();
            } else {
                if let Some(pai) = destino.parent() {
                    std::fs::create_dir_all(pai).ok();
                }
                let mut arquivo_destino = std::fs::File::create(&destino)
                    .map_err(|e| format!("Erro ao criar arquivo {}: {}", nome_str, e))?;
                std::io::copy(&mut entry, &mut arquivo_destino)
                    .map_err(|e| format!("Erro ao extrair {}: {}", nome_str, e))?;
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(ResultadoImportacaoArquivo {
        sucesso: true,
        instancia_id: Some(instancia_criada.id.clone()),
        mensagem: format!(
            "Instância '{}' importada com sucesso.",
            instancia_criada.name
        ),
    })
}

// ===== FUNÇÃO PARA BUSCAR VERSÕES DOS LOADERS =====

#[cfg(test)]
mod testes_progresso_importacao {
    use super::{calcular_porcentagem, copiar_conteudo_instancia_importada};

    #[test]
    fn calcula_porcentagem_por_arquivos_e_limita_em_cem() {
        assert_eq!(calcular_porcentagem(0, 10), 0);
        assert_eq!(calcular_porcentagem(1, 4), 25);
        assert_eq!(calcular_porcentagem(3, 4), 75);
        assert_eq!(calcular_porcentagem(4, 4), 100);
        assert_eq!(calcular_porcentagem(5, 4), 100);
    }

    #[test]
    fn mantem_zero_quando_nao_ha_arquivos() {
        assert_eq!(calcular_porcentagem(0, 0), 0);
    }

    #[test]
    fn copia_arquivos_previstos_e_reporta_cada_avanco() {
        let pasta_teste = std::env::temp_dir().join(format!(
            "dome-importacao-progresso-{}",
            uuid::Uuid::new_v4()
        ));
        let origem = pasta_teste.join("origem");
        let destino = pasta_teste.join("destino");
        std::fs::create_dir_all(origem.join("mods")).unwrap();
        std::fs::create_dir_all(origem.join("saves").join("mundo")).unwrap();
        std::fs::create_dir_all(origem.join("config").join("vazio")).unwrap();
        std::fs::write(origem.join("mods").join("exemplo.jar"), b"mod").unwrap();
        std::fs::write(
            origem.join("saves").join("mundo").join("level.dat"),
            b"mundo",
        )
        .unwrap();
        std::fs::write(origem.join("options.txt"), b"opcoes").unwrap();
        std::fs::write(origem.join("latest.log"), b"ignorado").unwrap();

        let mut atualizacoes = Vec::new();
        let total = copiar_conteudo_instancia_importada(
            &origem,
            &destino,
            |arquivos_copiados, total_arquivos| {
                atualizacoes.push((arquivos_copiados, total_arquivos));
            },
        )
        .unwrap();

        let mod_copiado = destino.join("mods").join("exemplo.jar").is_file();
        let mundo_copiado = destino
            .join("saves")
            .join("mundo")
            .join("level.dat")
            .is_file();
        let opcoes_copiadas = destino.join("options.txt").is_file();
        let pasta_vazia_copiada = destino.join("config").join("vazio").is_dir();
        let arquivo_ignorado = destino.join("latest.log").exists();
        std::fs::remove_dir_all(&pasta_teste).unwrap();

        assert_eq!(total, 3);
        assert_eq!(atualizacoes, vec![(0, 3), (1, 3), (2, 3), (3, 3)]);
        assert!(mod_copiado);
        assert!(mundo_copiado);
        assert!(opcoes_copiadas);
        assert!(pasta_vazia_copiada);
        assert!(!arquivo_ignorado);
    }
}
