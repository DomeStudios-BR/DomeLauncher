use std::path::Path;

use serde::Serialize;

use super::indice_mods_crash::{indexar_mods, ModIndexado};
use super::relacoes_crash::{classe_alvo_mixin, completar_relacoes};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModSuspeito {
    pub nome: String,
    pub arquivo: String,
    pub confianca: &'static str,
    pub evidencias: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relacao: Option<&'static str>,
}

pub(super) struct OrigemCrash {
    pub descricao: Option<String>,
    pub mods: Vec<ModSuspeito>,
    pub avisos: Vec<String>,
}

fn marcador_fatal(linha: &str) -> bool {
    [
        "Encountered an unexpected exception",
        "Unhandled game exception",
        "Uncaught exception",
        "Could not execute entrypoint stage",
        "Failed to start",
        "Minecraft Crash Report",
        "ModLoadingException",
        "LoadingFailedException",
        "Incompatible mods found!",
        "A fatal error has been detected",
        "Exception in thread",
        "/FATAL]",
        "There is insufficient memory for the Java Runtime Environment to continue",
        "Could not reserve enough space",
        "UnsupportedClassVersionError",
        "Mixin apply for mod",
    ]
    .iter()
    .any(|marcador| linha.contains(marcador))
}

fn blocos_fatais(texto: &str) -> Vec<Vec<&str>> {
    let linhas = texto.lines().collect::<Vec<_>>();
    let mut blocos = Vec::new();
    let mut indice = 0;
    while indice < linhas.len() {
        let linha = linhas[indice];
        let secao_mod = linha.trim_start().starts_with("-- MOD ");
        if (!marcador_fatal(linha) && !secao_mod) || linha.contains("/WARN]") {
            indice += 1;
            continue;
        }
        let inicio = indice;
        indice += 1;
        while indice < linhas.len()
            && !linhas[indice].contains("A detailed walkthrough")
            && !linhas[indice].trim_start().starts_with("-- ")
            && !linhas[indice].contains("/INFO]")
        {
            indice += 1;
        }
        let bloco = linhas[inicio..indice].to_vec();
        if !secao_mod
            || bloco
                .iter()
                .any(|linha| linha.trim_start().starts_with("Failure message:"))
        {
            blocos.push(bloco);
        }
    }
    blocos
}

pub(super) fn classe_frame(linha: &str) -> Option<String> {
    let frame = linha.trim().strip_prefix("at ")?.split('(').next()?;
    let frame = frame.rsplit('/').next()?;
    Some(frame.rsplit_once('.')?.0.into())
}

fn palavra_exata(texto: &str, palavra: &str) -> bool {
    if palavra.is_empty() {
        return false;
    }
    texto.match_indices(palavra).any(|(indice, _)| {
        let inicio = texto[..indice].chars().next_back();
        let fim = texto[indice + palavra.len()..].chars().next();
        let identificador = |letra: char| letra.is_alphanumeric() || letra == '_' || letra == '-';
        !inicio.is_some_and(identificador) && !fim.is_some_and(identificador)
    })
}

fn evidencia_explicita(linha: &str, item: &ModIndexado) -> Option<u8> {
    if linha.contains("/WARN]") || linha.contains("/INFO]") {
        return None;
    }
    let entrada = linha.contains("Could not execute entrypoint stage")
        && item
            .identificadores
            .iter()
            .any(|id| linha.contains(&format!("provided by '{}'", id)));
    let mod_explicito = linha.split_once("from mod ").and_then(|(_, trecho)| {
        trecho
            .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            .find(|parte| !parte.is_empty())
    });
    let forte = mod_explicito.is_some_and(|id| item.identificadores.iter().any(|item| item == id))
        || linha.trim_start().starts_with("Mod File:") && palavra_exata(linha, &item.arquivo);
    if forte {
        return Some(110);
    }
    if entrada {
        return Some(100);
    }
    let dependencia = linha.contains(" requires ")
        || linha.contains(" depends on ")
        || linha.contains(" is incompatible with ");
    if dependencia
        && item.identificadores.iter().any(|id| {
            linha.contains(&format!("({})", id)) || linha.contains(&format!("Mod ID: '{}'", id))
        })
    {
        return Some(100);
    }
    let mixin_fatal = classe_frame(linha).is_none()
        && [
            "Mixin apply",
            "MixinApplyError",
            "InjectionError",
            "InvalidInjectionException",
            "FAILED during APPLY",
        ]
        .iter()
        .any(|padrao| linha.contains(padrao));
    if mixin_fatal
        && !linha.contains("/WARN]")
        && item.mixins.iter().any(|mixin| palavra_exata(linha, mixin))
    {
        return Some(110);
    }
    None
}

pub(super) fn identificar_origem(raiz: &Path, fontes: &[(String, String)]) -> OrigemCrash {
    let blocos = fontes
        .iter()
        .flat_map(|(_, texto)| blocos_fatais(texto))
        .collect::<Vec<_>>();
    let linhas = blocos.iter().flatten().copied().collect::<Vec<_>>();
    let mut resultado = OrigemCrash {
        descricao: None,
        mods: Vec::new(),
        avisos: Vec::new(),
    };
    if linhas.is_empty() {
        return resultado;
    }
    for (padrao, descricao) in [
        ("OutOfMemoryError", "memória insuficiente para o Java"),
        (
            "There is insufficient memory for the Java Runtime Environment to continue",
            "memória nativa insuficiente",
        ),
        (
            "Could not reserve enough space",
            "memória insuficiente para iniciar o Java",
        ),
        (
            "UnsupportedClassVersionError",
            "versão do Java incompatível",
        ),
        (
            "EXCEPTION_ACCESS_VIOLATION",
            "falha nativa da JVM ou de um driver",
        ),
        ("SIGSEGV", "falha nativa da JVM ou de um driver"),
    ] {
        if linhas.iter().any(|linha| linha.contains(padrao)) {
            resultado.descricao = Some(descricao.into());
            return resultado;
        }
    }

    let classes = linhas
        .iter()
        .rev()
        .filter_map(|linha| classe_frame(linha).or_else(|| classe_alvo_mixin(linha)))
        .take(256)
        .collect::<Vec<_>>();
    let (indice, avisos) = indexar_mods(raiz, &classes);
    resultado.avisos = avisos;
    let mut candidatos = Vec::new();
    for item in &indice {
        let mut pontuacao = 0;
        let mut evidencias = Vec::new();
        for bloco in &blocos {
            let causa = bloco
                .iter()
                .rposition(|linha| linha.trim_start().starts_with("Caused by:"));
            let quadros = &bloco[causa.unwrap_or(0)..];
            let primeiro_mod = quadros
                .iter()
                .filter_map(|linha| classe_frame(linha).map(|classe| (*linha, classe)))
                .find(|(_, classe)| indice.iter().any(|item| item.classes.contains(classe)));
            if let Some((linha, classe)) = primeiro_mod {
                if item.classes.contains(&classe) {
                    pontuacao = pontuacao.max(if causa.is_some() { 105 } else { 80 });
                    evidencias.push(linha.to_string());
                }
            }
            for linha in bloco {
                if let Some(pontos) = evidencia_explicita(linha, item) {
                    pontuacao = pontuacao.max(pontos);
                    evidencias.push(linha.to_string());
                }
            }
        }
        if pontuacao == 0 {
            continue;
        }
        evidencias.sort();
        evidencias.dedup();
        evidencias.truncate(3);
        candidatos.push((
            pontuacao,
            ModSuspeito {
                nome: item.nome.clone(),
                arquivo: item.arquivo.clone(),
                confianca: if pontuacao >= 100 && pontuacao != 105 {
                    "alta"
                } else {
                    "média"
                },
                evidencias: evidencias
                    .into_iter()
                    .map(|linha| linha.chars().take(800).collect())
                    .collect(),
                relacao: None,
            },
        ));
    }
    candidatos.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.nome.cmp(&b.1.nome)));
    if let Some((maior, _)) = candidatos.first() {
        let maior = *maior;
        resultado.mods = candidatos
            .into_iter()
            .filter(|(pontos, _)| *pontos == maior)
            .map(|(_, item)| item)
            .collect();
        resultado
            .mods
            .dedup_by(|a, b| a.arquivo == b.arquivo && a.nome == b.nome);
        resultado.descricao = Some(
            resultado
                .mods
                .iter()
                .map(|item| item.nome.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    completar_relacoes(&mut resultado, &indice, &blocos);
    resultado
}
