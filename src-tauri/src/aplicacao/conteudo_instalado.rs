use super::*;
use base64::Engine as _;
use std::io::{Read, Seek};

const LIMITE_METADADOS_BYTES: u64 = 1024 * 1024;
const LIMITE_ICONE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConteudoInstaladoDetalhado {
    pub file_name: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub icon: Option<String>,
    pub enabled: bool,
    pub identificadores: Vec<String>,
    pub dependencias: Vec<String>,
}

#[derive(Default)]
struct MetadadosConteudo {
    nome: Option<String>,
    versao: Option<String>,
    autor: Option<String>,
    caminho_icone: Option<String>,
    identificadores: Vec<String>,
    dependencias: Vec<String>,
}

#[tauri::command]
pub(crate) async fn obter_conteudo_instalado_detalhado(
    instance_id: String,
    content_type: String,
    state: State<'_, LauncherState>,
) -> Result<Vec<ConteudoInstaladoDetalhado>, String> {
    let instancia = obter_instancia_por_id(&state, &instance_id)?;
    let tipo = content_type.trim().to_lowercase();
    let (pasta, aceita_diretorio) = match tipo.as_str() {
        "mods" => ("mods", false),
        "resourcepacks" => ("resourcepacks", true),
        "shaders" => ("shaderpacks", true),
        _ => return Err("Tipo de conteúdo inválido.".to_string()),
    };

    let caminho_pasta = instancia.path.join(pasta);
    if !caminho_pasta.is_dir() {
        return Ok(Vec::new());
    }

    tauri::async_runtime::spawn_blocking(move || {
        listar_conteudo_da_pasta(&caminho_pasta, &tipo, aceita_diretorio)
    })
    .await
    .map_err(|e| format!("Falha ao inspecionar conteúdo instalado: {}", e))?
}

fn listar_conteudo_da_pasta(
    caminho_pasta: &std::path::Path,
    tipo: &str,
    aceita_diretorio: bool,
) -> Result<Vec<ConteudoInstaladoDetalhado>, String> {
    let mut conteudos = std::fs::read_dir(caminho_pasta)
        .map_err(|e| format!("Erro ao ler conteúdo instalado: {}", e))?
        .flatten()
        .filter_map(|entrada| {
            let caminho = entrada.path();
            let nome_arquivo = entrada.file_name().to_string_lossy().to_string();
            let nome_minusculo = nome_arquivo.to_lowercase();
            let arquivo_compativel = if tipo == "mods" {
                nome_minusculo.ends_with(".jar") || nome_minusculo.ends_with(".jar.disabled")
            } else {
                nome_minusculo.ends_with(".zip") || nome_minusculo.ends_with(".zip.disabled")
            };

            if !(arquivo_compativel || aceita_diretorio && caminho.is_dir()) {
                return None;
            }

            Some(inspecionar_conteudo(&caminho, &nome_arquivo, tipo))
        })
        .collect::<Vec<_>>();

    conteudos.sort_by_key(|conteudo| conteudo.name.to_lowercase());
    Ok(conteudos)
}

fn inspecionar_conteudo(
    caminho: &std::path::Path,
    nome_arquivo: &str,
    tipo: &str,
) -> ConteudoInstaladoDetalhado {
    let habilitado = !nome_arquivo.to_lowercase().ends_with(".disabled");
    let nome_fallback = nome_legivel_arquivo(nome_arquivo);
    let (metadados, icone) = if caminho.is_dir() {
        inspecionar_pasta(caminho)
    } else {
        inspecionar_arquivo_compactado(caminho, tipo)
    };

    ConteudoInstaladoDetalhado {
        file_name: nome_arquivo.to_string(),
        name: metadados.nome.unwrap_or(nome_fallback),
        version: metadados.versao.unwrap_or_default(),
        author: metadados.autor.unwrap_or_else(|| "Unknown".to_string()),
        icon: icone,
        enabled: habilitado,
        identificadores: metadados.identificadores,
        dependencias: metadados.dependencias,
    }
}

fn inspecionar_pasta(caminho: &std::path::Path) -> (MetadadosConteudo, Option<String>) {
    let icone = std::fs::read(caminho.join("pack.png"))
        .ok()
        .filter(|bytes| bytes.len() as u64 <= LIMITE_ICONE_BYTES)
        .map(|bytes| converter_icone_data_uri(&bytes, "pack.png"));
    (MetadadosConteudo::default(), icone)
}

fn inspecionar_arquivo_compactado(
    caminho: &std::path::Path,
    tipo: &str,
) -> (MetadadosConteudo, Option<String>) {
    let Ok(arquivo) = std::fs::File::open(caminho) else {
        return (MetadadosConteudo::default(), None);
    };
    let Ok(mut compactado) = zip::ZipArchive::new(arquivo) else {
        return (MetadadosConteudo::default(), None);
    };

    let metadados = if tipo == "mods" {
        ler_metadados_mod(&mut compactado)
    } else {
        MetadadosConteudo::default()
    };
    let caminho_icone = metadados
        .caminho_icone
        .clone()
        .or_else(|| (tipo != "mods").then(|| "pack.png".to_string()));
    let icone = caminho_icone
        .as_deref()
        .and_then(|nome| ler_entrada(&mut compactado, nome, LIMITE_ICONE_BYTES))
        .map(|bytes| {
            converter_icone_data_uri(&bytes, caminho_icone.as_deref().unwrap_or("icone.png"))
        });

    (metadados, icone)
}

fn ler_metadados_mod<R: Read + Seek>(compactado: &mut zip::ZipArchive<R>) -> MetadadosConteudo {
    ler_fabric(compactado)
        .or_else(|| ler_quilt(compactado))
        .or_else(|| ler_toml_mod(compactado, "META-INF/neoforge.mods.toml"))
        .or_else(|| ler_toml_mod(compactado, "META-INF/mods.toml"))
        .or_else(|| ler_forge_legado(compactado))
        .unwrap_or_else(|| ler_manifesto(compactado))
}

fn ler_fabric<R: Read + Seek>(compactado: &mut zip::ZipArchive<R>) -> Option<MetadadosConteudo> {
    let json = ler_json(compactado, "fabric.mod.json")?;
    let identificadores = normalizar_identificadores(
        texto_json(&json, "id")
            .into_iter()
            .chain(identificadores_json(json.get("provides"))),
    );
    let dependencias = normalizar_identificadores(
        json.get("depends")
            .and_then(serde_json::Value::as_object)
            .into_iter()
            .flat_map(|itens| itens.keys().cloned()),
    );

    Some(MetadadosConteudo {
        nome: texto_json(&json, "name").or_else(|| texto_json(&json, "id")),
        versao: valor_json_texto(json.get("version")),
        autor: autores_json(json.get("authors")),
        caminho_icone: json.get("icon").and_then(caminho_icone_json),
        identificadores,
        dependencias,
    })
}

fn ler_quilt<R: Read + Seek>(compactado: &mut zip::ZipArchive<R>) -> Option<MetadadosConteudo> {
    let texto = ler_texto(compactado, "quilt.mod.json")?;
    let json = json5::from_str::<serde_json::Value>(&texto).ok()?;
    let loader = json.get("quilt_loader").unwrap_or(&json);
    let exibicao = loader.get("metadata").unwrap_or(loader);
    let autores = exibicao
        .get("contributors")
        .and_then(|valor| valor.as_object())
        .map(|autores| autores.keys().cloned().collect::<Vec<_>>().join(", "))
        .filter(|valor| !valor.is_empty());
    let identificadores = normalizar_identificadores(
        texto_json(loader, "id")
            .into_iter()
            .chain(identificadores_json(loader.get("provides"))),
    );
    let dependencias = normalizar_identificadores(identificadores_json(loader.get("depends")));

    Some(MetadadosConteudo {
        nome: texto_json(exibicao, "name").or_else(|| texto_json(loader, "id")),
        versao: valor_json_texto(loader.get("version")),
        autor: autores,
        caminho_icone: exibicao
            .get("icon")
            .or_else(|| loader.get("icon"))
            .and_then(caminho_icone_json),
        identificadores,
        dependencias,
    })
}

fn ler_toml_mod<R: Read + Seek>(
    compactado: &mut zip::ZipArchive<R>,
    nome: &str,
) -> Option<MetadadosConteudo> {
    let texto = ler_texto(compactado, nome)?;
    let toml = toml::from_str::<toml::Value>(&texto).ok()?;
    let mods = toml.get("mods")?.as_array()?;
    let dados_mod = mods.first()?.as_table()?;
    let manifesto = ler_manifesto(compactado);
    let versao = dados_mod
        .get("version")
        .and_then(valor_toml_texto)
        .and_then(|valor| {
            if valor == "${file.jarVersion}" {
                manifesto.versao
            } else {
                Some(valor)
            }
        });
    let autor = dados_mod
        .get("authors")
        .or_else(|| toml.get("authors"))
        .and_then(valor_toml_texto);
    let identificadores = normalizar_identificadores(
        mods.iter()
            .filter_map(|item| item.as_table()?.get("modId").and_then(valor_toml_texto)),
    );
    let dependencias = normalizar_identificadores(
        toml.get("dependencies")
            .and_then(toml::Value::as_table)
            .into_iter()
            .flat_map(|grupos| grupos.values())
            .filter_map(toml::Value::as_array)
            .flatten()
            .filter_map(|item| {
                let tabela = item.as_table()?;
                let obrigatoria = tabela
                    .get("mandatory")
                    .and_then(toml::Value::as_bool)
                    .unwrap_or(true);
                let tipo_obrigatorio = tabela
                    .get("type")
                    .and_then(toml::Value::as_str)
                    .map(|tipo| tipo.eq_ignore_ascii_case("required"))
                    .unwrap_or(true);
                (obrigatoria && tipo_obrigatorio)
                    .then(|| tabela.get("modId").and_then(valor_toml_texto))
                    .flatten()
            }),
    );

    Some(MetadadosConteudo {
        nome: dados_mod
            .get("displayName")
            .or_else(|| dados_mod.get("modId"))
            .and_then(valor_toml_texto),
        versao,
        autor,
        caminho_icone: dados_mod
            .get("logoFile")
            .and_then(toml::Value::as_str)
            .and_then(caminho_seguro_compactado),
        identificadores,
        dependencias,
    })
}

fn ler_forge_legado<R: Read + Seek>(
    compactado: &mut zip::ZipArchive<R>,
) -> Option<MetadadosConteudo> {
    let json = ler_json(compactado, "mcmod.info")?;
    let entrada = json
        .as_array()
        .and_then(|itens| itens.first())
        .or_else(|| json.get("modList")?.as_array()?.first())?;
    let identificadores = normalizar_identificadores(texto_json(entrada, "modid"));
    let dependencias = normalizar_identificadores(
        entrada
            .get("dependencies")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .filter_map(identificador_dependencia_legada)
            .map(str::to_string),
    );

    Some(MetadadosConteudo {
        nome: texto_json(entrada, "name").or_else(|| texto_json(entrada, "modid")),
        versao: valor_json_texto(entrada.get("version")),
        autor: autores_json(entrada.get("authorList")),
        caminho_icone: entrada
            .get("logoFile")
            .and_then(serde_json::Value::as_str)
            .and_then(caminho_seguro_compactado),
        identificadores,
        dependencias,
    })
}

fn ler_manifesto<R: Read + Seek>(compactado: &mut zip::ZipArchive<R>) -> MetadadosConteudo {
    let Some(texto) = ler_texto(compactado, "META-INF/MANIFEST.MF") else {
        return MetadadosConteudo::default();
    };
    let mut valores = std::collections::HashMap::new();
    for linha in texto.lines() {
        let Some((chave, valor)) = linha.split_once(':') else {
            continue;
        };
        valores.insert(chave.trim().to_lowercase(), valor.trim().to_string());
    }

    MetadadosConteudo {
        nome: valores.get("implementation-title").cloned(),
        versao: valores.get("implementation-version").cloned(),
        autor: valores
            .get("implementation-vendor")
            .or_else(|| valores.get("specification-vendor"))
            .cloned(),
        caminho_icone: None,
        identificadores: Vec::new(),
        dependencias: Vec::new(),
    }
}

fn identificadores_json(valor: Option<&serde_json::Value>) -> Vec<String> {
    match valor {
        Some(serde_json::Value::String(item)) => vec![item.clone()],
        Some(serde_json::Value::Array(itens)) => itens
            .iter()
            .flat_map(|item| identificadores_json(Some(item)))
            .collect(),
        Some(serde_json::Value::Object(item)) => item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(|id| vec![id.to_string()])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn normalizar_identificadores(valores: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut identificadores = valores
        .into_iter()
        .filter_map(|valor| texto_limpo(&valor).map(|item| item.to_lowercase()))
        .collect::<Vec<_>>();
    identificadores.sort();
    identificadores.dedup();
    identificadores
}

fn identificador_dependencia_legada(valor: &str) -> Option<&str> {
    let valor = valor.trim();
    let identificador = valor
        .strip_prefix("required-after:")
        .or_else(|| valor.strip_prefix("required-before:"))
        .unwrap_or(valor)
        .split(['@', '[', '('])
        .next()?
        .trim();
    (!identificador.is_empty()).then_some(identificador)
}

fn ler_json<R: Read + Seek>(
    compactado: &mut zip::ZipArchive<R>,
    nome: &str,
) -> Option<serde_json::Value> {
    let texto = ler_texto(compactado, nome)?;
    serde_json::from_str(&texto)
        .or_else(|_| serde_json::from_str(&escapar_controles_em_strings_json(&texto)))
        .ok()
}

fn escapar_controles_em_strings_json(texto: &str) -> String {
    let mut resultado = String::with_capacity(texto.len());
    let mut caracteres = texto.chars().peekable();
    let mut dentro_string = false;
    let mut caractere_escapado = false;

    while let Some(caractere) = caracteres.next() {
        if !dentro_string {
            resultado.push(caractere);
            if caractere == '"' {
                dentro_string = true;
            }
            continue;
        }

        if caractere_escapado {
            resultado.push(caractere);
            caractere_escapado = false;
            continue;
        }

        match caractere {
            '\\' => {
                resultado.push(caractere);
                caractere_escapado = true;
            }
            '"' => {
                resultado.push(caractere);
                dentro_string = false;
            }
            '\r' => {
                if caracteres.peek() == Some(&'\n') {
                    caracteres.next();
                }
                resultado.push_str("\\n");
            }
            '\n' => resultado.push_str("\\n"),
            '\t' => resultado.push_str("\\t"),
            caractere if caractere.is_control() => {
                resultado.push_str(&format!("\\u{:04x}", caractere as u32));
            }
            _ => resultado.push(caractere),
        }
    }

    resultado
}

fn ler_texto<R: Read + Seek>(compactado: &mut zip::ZipArchive<R>, nome: &str) -> Option<String> {
    String::from_utf8(ler_entrada(compactado, nome, LIMITE_METADADOS_BYTES)?).ok()
}

fn ler_entrada<R: Read + Seek>(
    compactado: &mut zip::ZipArchive<R>,
    nome: &str,
    limite: u64,
) -> Option<Vec<u8>> {
    let nome = caminho_seguro_compactado(nome)?;
    let entrada = compactado.by_name(&nome).ok()?;
    if entrada.size() > limite {
        return None;
    }
    let mut bytes = Vec::with_capacity(entrada.size() as usize);
    entrada.take(limite + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= limite).then_some(bytes)
}

fn caminho_icone_json(valor: &serde_json::Value) -> Option<String> {
    if let Some(caminho) = valor.as_str() {
        return caminho_seguro_compactado(caminho);
    }
    let mut icones = valor
        .as_object()?
        .iter()
        .filter_map(|(tamanho, caminho)| {
            Some((
                tamanho.parse::<u32>().ok()?,
                caminho_seguro_compactado(caminho.as_str()?)?,
            ))
        })
        .collect::<Vec<_>>();
    icones.sort_by_key(|(tamanho, _)| *tamanho);
    icones.last().map(|(_, caminho)| caminho.clone())
}

fn caminho_seguro_compactado(caminho: &str) -> Option<String> {
    let caminho = caminho.trim().trim_start_matches('/');
    if caminho.is_empty()
        || caminho.contains('\0')
        || caminho.contains('\\')
        || caminho
            .split('/')
            .any(|parte| parte.is_empty() || parte == "." || parte == "..")
    {
        return None;
    }
    Some(caminho.to_string())
}

fn texto_json(json: &serde_json::Value, chave: &str) -> Option<String> {
    json.get(chave)
        .and_then(serde_json::Value::as_str)
        .and_then(texto_limpo)
}

fn valor_json_texto(valor: Option<&serde_json::Value>) -> Option<String> {
    match valor? {
        serde_json::Value::String(valor) => texto_limpo(valor),
        serde_json::Value::Number(valor) => Some(valor.to_string()),
        _ => None,
    }
}

fn autores_json(valor: Option<&serde_json::Value>) -> Option<String> {
    let autores = valor?
        .as_array()?
        .iter()
        .filter_map(|autor| {
            autor
                .as_str()
                .or_else(|| autor.get("name").and_then(serde_json::Value::as_str))
                .and_then(texto_limpo)
        })
        .collect::<Vec<_>>();
    (!autores.is_empty()).then(|| autores.join(", "))
}

fn valor_toml_texto(valor: &toml::Value) -> Option<String> {
    match valor {
        toml::Value::String(valor) => texto_limpo(valor),
        toml::Value::Integer(valor) => Some(valor.to_string()),
        toml::Value::Float(valor) => Some(valor.to_string()),
        toml::Value::Array(valores) => {
            let itens = valores
                .iter()
                .filter_map(valor_toml_texto)
                .collect::<Vec<_>>();
            (!itens.is_empty()).then(|| itens.join(", "))
        }
        _ => None,
    }
}

fn texto_limpo(valor: &str) -> Option<String> {
    let valor = valor.trim();
    if valor.is_empty() || valor.contains("${") {
        return None;
    }
    Some(
        valor
            .chars()
            .filter(|caractere| !caractere.is_control())
            .take(256)
            .collect(),
    )
}

fn nome_legivel_arquivo(nome: &str) -> String {
    nome.trim_end_matches(".disabled")
        .trim_end_matches(".jar")
        .trim_end_matches(".zip")
        .replace(['-', '_'], " ")
}

fn converter_icone_data_uri(bytes: &[u8], nome: &str) -> String {
    let mime = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"\xFF\xD8") {
        "image/jpeg"
    } else if nome.to_lowercase().ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png"
    };
    let base64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    format!("data:{};base64,{}", mime, base64)
}

#[cfg(test)]
mod testes {
    use super::{inspecionar_arquivo_compactado, inspecionar_conteudo};
    use std::io::Write;

    #[test]
    fn extrai_metadados_e_icone_de_mod_fabric() {
        let caminho = std::env::temp_dir().join(format!(
            "dome-conteudo-instalado-{}.jar",
            uuid::Uuid::new_v4()
        ));
        let arquivo = std::fs::File::create(&caminho).expect("deve criar arquivo temporário");
        let mut compactado = zip::ZipWriter::new(arquivo);
        let opcoes = zip::write::SimpleFileOptions::default();
        compactado
            .start_file("fabric.mod.json", opcoes)
            .expect("deve criar metadados");
        compactado
            .write_all(
                br#"{"id":"dome-teste","provides":["dome-api"],"depends":{"fabricloader":">=0.16","biblioteca":"*"},"name":"Dome Teste","version":"1.2.3","authors":["Dome"],"icon":"icone.png"}"#,
            )
            .expect("deve escrever metadados");
        compactado
            .start_file("icone.png", opcoes)
            .expect("deve criar ícone");
        compactado
            .write_all(b"\x89PNG\r\n\x1a\n")
            .expect("deve escrever ícone");
        compactado.finish().expect("deve finalizar arquivo");

        let (metadados, icone) = inspecionar_arquivo_compactado(&caminho, "mods");
        let _ = std::fs::remove_file(caminho);

        assert_eq!(metadados.nome.as_deref(), Some("Dome Teste"));
        assert_eq!(metadados.versao.as_deref(), Some("1.2.3"));
        assert_eq!(metadados.autor.as_deref(), Some("Dome"));
        assert_eq!(metadados.identificadores, vec!["dome-api", "dome-teste"]);
        assert_eq!(metadados.dependencias, vec!["biblioteca", "fabricloader"]);
        assert!(icone.is_some_and(|valor| valor.starts_with("data:image/png;base64,")));
    }

    #[test]
    fn extrai_dependencias_obrigatorias_de_mod_neoforge() {
        let caminho = std::env::temp_dir().join(format!(
            "dome-conteudo-instalado-neoforge-{}.jar",
            uuid::Uuid::new_v4()
        ));
        let arquivo = std::fs::File::create(&caminho).expect("deve criar arquivo temporário");
        let mut compactado = zip::ZipWriter::new(arquivo);
        let opcoes = zip::write::SimpleFileOptions::default();
        compactado
            .start_file("META-INF/neoforge.mods.toml", opcoes)
            .expect("deve criar metadados");
        compactado
            .write_all(
                br#"modLoader="javafml"
[[mods]]
modId="mod_principal"
displayName="Mod principal"
version="1.0.0"
[[dependencies.mod_principal]]
modId="biblioteca"
type="required"
[[dependencies.mod_principal]]
modId="integracao_opcional"
type="optional"
"#,
            )
            .expect("deve escrever metadados");
        compactado.finish().expect("deve finalizar arquivo");

        let (metadados, _) = inspecionar_arquivo_compactado(&caminho, "mods");
        let _ = std::fs::remove_file(caminho);

        assert_eq!(metadados.identificadores, vec!["mod_principal"]);
        assert_eq!(metadados.dependencias, vec!["biblioteca"]);
    }

    #[test]
    fn extrai_metadados_fabric_com_quebra_de_linha_em_string() {
        let caminho = std::env::temp_dir().join(format!(
            "dome-conteudo-instalado-invalido-{}.jar",
            uuid::Uuid::new_v4()
        ));
        let arquivo = std::fs::File::create(&caminho).expect("deve criar arquivo temporário");
        let mut compactado = zip::ZipWriter::new(arquivo);
        let opcoes = zip::write::SimpleFileOptions::default();
        compactado
            .start_file("fabric.mod.json", opcoes)
            .expect("deve criar metadados");
        compactado
            .write_all(
                b"{\"id\":\"emf\",\"name\":\"Entity Model Features\",\"description\":\"Linha um\nLinha dois\",\"version\":\"3.2.4\",\"authors\":[{\"name\":\"Traben\"}]}",
            )
            .expect("deve escrever metadados tolerados pelo Fabric");
        compactado.finish().expect("deve finalizar arquivo");

        let (metadados, _) = inspecionar_arquivo_compactado(&caminho, "mods");
        let _ = std::fs::remove_file(caminho);

        assert_eq!(metadados.nome.as_deref(), Some("Entity Model Features"));
        assert_eq!(metadados.versao.as_deref(), Some("3.2.4"));
        assert_eq!(metadados.autor.as_deref(), Some("Traben"));
    }

    #[test]
    fn extrai_icone_de_textura_e_shader_compactados() {
        let caminho =
            std::env::temp_dir().join(format!("dome-pack-instalado-{}.zip", uuid::Uuid::new_v4()));
        let arquivo = std::fs::File::create(&caminho).expect("deve criar arquivo temporário");
        let mut compactado = zip::ZipWriter::new(arquivo);
        let opcoes = zip::write::SimpleFileOptions::default();
        compactado
            .start_file("pack.png", opcoes)
            .expect("deve criar ícone");
        compactado
            .write_all(b"\x89PNG\r\n\x1a\n")
            .expect("deve escrever ícone");
        compactado.finish().expect("deve finalizar arquivo");

        for tipo in ["resourcepacks", "shaders"] {
            let conteudo = inspecionar_conteudo(&caminho, "Pack Bonito.zip", tipo);
            assert_eq!(conteudo.name, "Pack Bonito");
            assert!(conteudo
                .icon
                .is_some_and(|valor| valor.starts_with("data:image/png;base64,")));
        }

        let _ = std::fs::remove_file(caminho);
    }
}
