use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Seek};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RequisitosModpack {
    pub versao_minecraft: String,
    pub loader: String,
    pub versao_loader: Option<String>,
}

fn texto_obrigatorio(valor: &Value, campo: &str) -> Result<String, String> {
    valor
        .as_str()
        .map(str::trim)
        .filter(|texto| !texto.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("O manifesto do modpack não informa {}.", campo))
}

fn ler_manifesto(arquivo: &mut impl Read) -> Result<Value, String> {
    let mut conteudo = String::new();
    arquivo
        .take(1024 * 1024 + 1)
        .read_to_string(&mut conteudo)
        .map_err(|e| format!("Erro ao ler manifesto do modpack: {}", e))?;
    if conteudo.len() > 1024 * 1024 {
        return Err("Manifesto do modpack excede 1 MiB.".into());
    }
    serde_json::from_str(&conteudo).map_err(|e| format!("Manifesto do modpack inválido: {}", e))
}

pub(super) fn ler_requisitos<R: Read + Seek>(
    arquivo: &mut zip::ZipArchive<R>,
) -> Result<RequisitosModpack, String> {
    match arquivo.by_name("modrinth.index.json") {
        Ok(mut manifesto) => return requisitos_modrinth(&ler_manifesto(&mut manifesto)?),
        Err(zip::result::ZipError::FileNotFound) => {}
        Err(erro) => return Err(format!("Erro ao abrir manifesto Modrinth: {}", erro)),
    }
    let mut manifesto = arquivo
        .by_name("manifest.json")
        .map_err(|e| format!("Manifesto do modpack não encontrado: {}", e))?;
    requisitos_curseforge(&ler_manifesto(&mut manifesto)?)
}

fn requisitos_modrinth(manifesto: &Value) -> Result<RequisitosModpack, String> {
    let dependencias = &manifesto["dependencies"];
    let versao_minecraft = texto_obrigatorio(&dependencias["minecraft"], "a versão do Minecraft")?;
    let loaders: Vec<_> = [
        ("forge", "forge"),
        ("neoforge", "neoforge"),
        ("fabric-loader", "fabric"),
        ("quilt-loader", "quilt"),
    ]
    .into_iter()
    .filter(|(chave, _)| dependencias.get(*chave).is_some())
    .collect();
    if loaders.len() > 1 {
        return Err("O manifesto do modpack declara mais de um loader.".into());
    }
    let Some((chave, loader)) = loaders.first() else {
        return Ok(RequisitosModpack {
            versao_minecraft,
            loader: "vanilla".into(),
            versao_loader: None,
        });
    };
    if *loader == "quilt" {
        return Err("O loader Quilt do modpack ainda não é suportado.".into());
    }
    Ok(RequisitosModpack {
        versao_minecraft,
        loader: loader.to_string(),
        versao_loader: Some(texto_obrigatorio(
            &dependencias[*chave],
            "a versão do loader",
        )?),
    })
}

fn requisitos_curseforge(manifesto: &Value) -> Result<RequisitosModpack, String> {
    let minecraft = &manifesto["minecraft"];
    let versao_minecraft = texto_obrigatorio(&minecraft["version"], "a versão do Minecraft")?;
    let loaders = minecraft["modLoaders"]
        .as_array()
        .ok_or("O manifesto não informa os loaders.")?;
    let principais: Vec<_> = loaders
        .iter()
        .filter(|loader| loader["primary"].as_bool() == Some(true))
        .collect();
    let selecionado = match (principais.as_slice(), loaders.as_slice()) {
        ([principal], _) => *principal,
        ([], [unico]) => unico,
        _ => return Err("O manifesto não informa um único loader principal.".into()),
    };
    let id = texto_obrigatorio(&selecionado["id"], "o identificador do loader")?;
    let (loader, versao) = id
        .split_once('-')
        .ok_or("Identificador do loader inválido no modpack.")?;
    if !matches!(loader, "forge" | "fabric" | "neoforge") || versao.trim().is_empty() {
        return Err(format!(
            "Loader não suportado ou sem versão no modpack: {}.",
            id
        ));
    }
    Ok(RequisitosModpack {
        versao_minecraft,
        loader: loader.into(),
        versao_loader: Some(versao.trim().into()),
    })
}

#[tauri::command]
/// Consulte antes de criar uma instância para preservar as versões exigidas pelo arquivo selecionado.
pub async fn obter_requisitos_modpack(download_url: String) -> Result<RequisitosModpack, String> {
    let cliente = super::cliente_modpack()?;
    let bytes = super::baixar_modpack(&cliente, &download_url).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut arquivo = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|e| format!("Arquivo de modpack inválido: {}", e))?;
        ler_requisitos(&mut arquivo)
    })
    .await
    .map_err(|e| format!("Erro ao ler requisitos do modpack: {}", e))?
}

#[cfg(test)]
mod testes {
    use super::*;
    use serde_json::json;
    use std::io::{Cursor, Write};

    fn requisitos_zip(nome: &str, manifesto: &Value) -> Result<RequisitosModpack, String> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(nome, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(manifesto.to_string().as_bytes()).unwrap();
        let mut arquivo = zip.finish().unwrap();
        arquivo.set_position(0);
        ler_requisitos(&mut zip::ZipArchive::new(arquivo).unwrap())
    }

    #[test]
    fn preserva_forge_exato_do_manifesto_gravitas() {
        let requisitos = requisitos_zip(
            "manifest.json",
            &json!({
                "minecraft": { "version": "1.20.1", "modLoaders": [
                    { "id": "forge-47.4.10", "primary": true }
                ] }
            }),
        )
        .unwrap();
        assert_eq!(requisitos.versao_minecraft, "1.20.1");
        assert_eq!(requisitos.loader, "forge");
        assert_eq!(requisitos.versao_loader.as_deref(), Some("47.4.10"));
    }

    #[test]
    fn respeita_loader_principal_em_vez_do_primeiro() {
        let requisitos = requisitos_curseforge(&json!({ "minecraft": {
            "version": "1.21.1", "modLoaders": [
                { "id": "forge-52.0.1", "primary": false },
                { "id": "neoforge-21.1.80", "primary": true }
            ]
        }}))
        .unwrap();
        assert_eq!(requisitos.loader, "neoforge");
        assert_eq!(requisitos.versao_loader.as_deref(), Some("21.1.80"));
    }

    #[test]
    fn preserva_versoes_dos_loaders_modrinth() {
        for (chave, loader, versao) in [
            ("forge", "forge", "47.4.10"),
            ("neoforge", "neoforge", "21.1.80"),
            ("fabric-loader", "fabric", "0.16.0"),
        ] {
            let mut manifesto = json!({ "dependencies": { "minecraft": "1.20.1" } });
            manifesto["dependencies"][chave] = json!(versao);
            let requisitos = requisitos_zip("modrinth.index.json", &manifesto).unwrap();
            assert_eq!(requisitos.loader, loader);
            assert_eq!(requisitos.versao_loader.as_deref(), Some(versao));
        }
    }

    #[test]
    fn aceita_curseforge_com_unico_loader_sem_primary() {
        let requisitos = requisitos_curseforge(&json!({ "minecraft": {
            "version": "1.20.1", "modLoaders": [{ "id": "fabric-0.16.0" }]
        }}))
        .unwrap();
        assert_eq!(requisitos.versao_loader.as_deref(), Some("0.16.0"));
    }

    #[test]
    fn rejeita_manifestos_ambiguos_incompletos_ou_nao_suportados() {
        for loaders in [
            json!([]),
            json!([{ "id": "forge-" }]),
            json!([{ "id": "quilt-0.26.0" }]),
            json!([{ "id": "forge-47.4.10" }, { "id": "fabric-0.16.0" }]),
            json!([{ "id": "forge-47.4.10", "primary": true },
                { "id": "fabric-0.16.0", "primary": true }]),
        ] {
            assert!(requisitos_curseforge(&json!({ "minecraft": {
                "version": "1.20.1", "modLoaders": loaders
            }}))
            .is_err());
        }
        for dependencias in [
            json!({ "forge": "47.4.10" }),
            json!({ "minecraft": "1.20.1", "forge": "" }),
            json!({ "minecraft": "1.20.1", "quilt-loader": "0.26.0" }),
            json!({ "minecraft": "1.20.1", "forge": "47.4.10", "fabric-loader": "0.16.0" }),
        ] {
            assert!(requisitos_modrinth(&json!({ "dependencies": dependencias })).is_err());
        }
        assert!(requisitos_zip("manifest.json", &json!({})).is_err());
        assert!(requisitos_zip("outro.json", &json!({})).is_err());
    }
}
