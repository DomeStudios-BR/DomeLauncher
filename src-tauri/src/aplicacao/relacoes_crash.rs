use super::indice_mods_crash::ModIndexado;
use super::origem_crash::{classe_frame, ModSuspeito, OrigemCrash};

pub(super) fn classe_alvo_mixin(linha: &str) -> Option<String> {
    if linha.contains("/WARN]") || linha.contains("/INFO]") || classe_frame(linha).is_some() {
        return None;
    }
    let trecho = if let Some((_, trecho)) = linha.split_once("Mixin transformation of ") {
        trecho
    } else if linha.contains("InvalidInjectionException")
        && linha.contains("could not find any targets")
    {
        linha.split_once("' in ")?.1
    } else {
        return None;
    };
    let classe = trecho
        .split_whitespace()
        .next()?
        .trim_end_matches(['.', ':']);
    if !classe.contains('/') && !classe.contains('.') {
        return None;
    }
    Some(classe.replace('/', "."))
}

fn mesmo_mod(item: &ModIndexado, suspeito: &ModSuspeito) -> bool {
    item.arquivo == suspeito.arquivo && item.nome == suspeito.nome
}

fn incluir_relacionado(
    resultado: &mut OrigemCrash,
    item: &ModIndexado,
    linha: &str,
    relacao: &'static str,
) {
    if resultado
        .mods
        .iter()
        .any(|suspeito| mesmo_mod(item, suspeito))
    {
        return;
    }
    resultado.mods.push(ModSuspeito {
        nome: item.nome.clone(),
        arquivo: item.arquivo.clone(),
        confianca: "média",
        evidencias: vec![linha.chars().take(800).collect()],
        relacao: Some(relacao),
    });
}

// Relacionar exige uma chamada contígua na causa ou uma classe alvo encontrada no JAR.
// Estar na lista de mods ou compartilhar um prefixo de pacote não basta.
pub(super) fn completar_relacoes(
    resultado: &mut OrigemCrash,
    indice: &[ModIndexado],
    blocos: &[Vec<&str>],
) {
    if resultado.mods.is_empty() {
        return;
    }
    let principais = resultado.mods.clone();
    for bloco in blocos {
        let causa = bloco
            .iter()
            .rposition(|linha| linha.trim_start().starts_with("Caused by:"));
        let mut cadeia = Vec::new();
        for linha in &bloco[causa.unwrap_or(0)..] {
            let Some(classe) = classe_frame(linha) else {
                continue;
            };
            let donos = indice
                .iter()
                .filter(|item| item.classes.contains(&classe))
                .collect::<Vec<_>>();
            if donos.is_empty() && !cadeia.is_empty() {
                break;
            }
            cadeia.extend(donos.into_iter().map(|item| (item, *linha)));
        }
        if cadeia
            .iter()
            .any(|(item, _)| principais.iter().any(|mod_| mesmo_mod(item, mod_)))
        {
            for (item, linha) in cadeia {
                incluir_relacionado(resultado, item, linha, "chamada");
            }
        }
        let origem_mixin = principais.iter().any(|mod_| {
            indice
                .iter()
                .filter(|item| mesmo_mod(item, mod_))
                .any(|item| {
                    bloco.iter().any(|linha| {
                        classe_frame(linha).is_none()
                            && !linha.contains("/WARN]")
                            && (linha.contains("MixinApplyError") || linha.contains("Mixin apply"))
                            && item
                                .mixins
                                .iter()
                                .any(|configuracao| linha.contains(configuracao))
                    })
                })
        });
        if !origem_mixin {
            continue;
        }
        for linha in bloco {
            if let Some(classe) = classe_alvo_mixin(linha) {
                for item in indice.iter().filter(|item| item.classes.contains(&classe)) {
                    incluir_relacionado(resultado, item, linha, "alvoMixin");
                }
            }
        }
    }
    let relacionados = resultado
        .mods
        .iter()
        .filter(|item| item.relacao.is_some())
        .map(|item| item.nome.as_str())
        .collect::<Vec<_>>();
    if !relacionados.is_empty() {
        if let Some(descricao) = &mut resultado.descricao {
            descricao.push_str(&format!(" (na mesma falha: {})", relacionados.join(", ")));
        }
    }
}
