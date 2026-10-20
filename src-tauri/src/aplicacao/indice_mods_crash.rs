use std::io::{Cursor, Read, Seek};
use std::path::Path;

use super::conteudo_instalado::ler_identidade_mod;
use crate::comandos::instancia_sistema::validar_caminho_dentro_raiz;

const LIMITE_JAR_INTERNO: u64 = 16 * 1024 * 1024;
const ORCAMENTO_JARS_INTERNOS: u64 = 64 * 1024 * 1024;

pub(super) struct ModIndexado {
    pub nome: String,
    pub arquivo: String,
    pub identificadores: Vec<String>,
    pub mixins: Vec<String>,
    pub classes: Vec<String>,
}

pub(super) fn indexar_mods(raiz: &Path, classes: &[String]) -> (Vec<ModIndexado>, Vec<String>) {
    let mut mods = Vec::new();
    let mut avisos = Vec::new();
    let pasta = raiz.join("mods");
    if !pasta.exists() {
        return (mods, avisos);
    }
    let Ok(entradas) = std::fs::read_dir(&pasta) else {
        avisos.push("Não foi possível consultar os mods instalados.".into());
        return (mods, avisos);
    };
    for entrada in entradas.flatten() {
        let caminho = entrada.path();
        let nome = entrada.file_name().to_string_lossy().to_string();
        if !nome.to_lowercase().ends_with(".jar") {
            continue;
        }
        let compactado = validar_caminho_dentro_raiz(raiz, &caminho)
            .ok()
            .and_then(|seguro| std::fs::File::open(seguro).ok())
            .and_then(|arquivo| zip::ZipArchive::new(arquivo).ok());
        let Some(mut compactado) = compactado else {
            avisos.push(format!("Não foi possível inspecionar {}.", nome));
            continue;
        };
        let mut orcamento = ORCAMENTO_JARS_INTERNOS;
        indexar_compactado(
            &mut compactado,
            &nome,
            classes,
            0,
            &mut orcamento,
            &mut mods,
        );
    }
    (mods, avisos)
}

fn indexar_compactado<R: Read + Seek>(
    compactado: &mut zip::ZipArchive<R>,
    arquivo: &str,
    classes: &[String],
    profundidade: u8,
    orcamento: &mut u64,
    mods: &mut Vec<ModIndexado>,
) {
    let (nome, identificadores) = ler_identidade_mod(compactado);
    let mixins = compactado
        .file_names()
        .filter(|nome| nome.ends_with(".json") && nome.to_lowercase().contains("mixin"))
        .map(str::to_string)
        .collect();
    let classes_presentes = classes
        .iter()
        .filter(|classe| {
            let caminho = format!("{}.class", classe.replace('.', "/"));
            compactado.by_name(&caminho).is_ok()
        })
        .cloned()
        .collect();
    mods.push(ModIndexado {
        nome: nome.unwrap_or_else(|| arquivo.to_string()),
        arquivo: arquivo.into(),
        identificadores,
        mixins,
        classes: classes_presentes,
    });
    if profundidade >= 2 {
        return;
    }
    let internos = compactado
        .file_names()
        .filter(|nome| nome.ends_with(".jar"))
        .map(str::to_string)
        .collect::<Vec<_>>();
    for interno in internos {
        let Ok(entrada) = compactado.by_name(&interno) else {
            continue;
        };
        let tamanho = entrada.size();
        if tamanho > LIMITE_JAR_INTERNO || tamanho > *orcamento {
            continue;
        }
        *orcamento = orcamento.saturating_sub(tamanho);
        let mut bytes = Vec::new();
        if entrada
            .take(LIMITE_JAR_INTERNO + 1)
            .read_to_end(&mut bytes)
            .is_err()
            || bytes.len() as u64 > LIMITE_JAR_INTERNO
        {
            continue;
        }
        if let Ok(mut aninhado) = zip::ZipArchive::new(Cursor::new(bytes)) {
            indexar_compactado(
                &mut aninhado,
                arquivo,
                classes,
                profundidade + 1,
                orcamento,
                mods,
            );
        }
    }
}
