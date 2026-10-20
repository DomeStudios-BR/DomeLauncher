use super::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static GRAVACAO_OPCOES: Mutex<()> = Mutex::new(());
type OpcoesJogo = BTreeMap<String, String>;

fn caminho_opcoes(state: &LauncherState, id: &str) -> Result<PathBuf, String> {
    let instancia = obter_instancia_por_id(state, id)?;
    let raiz = validar_caminho_dentro_raiz(&state.caminho_instancias()?, &instancia.path)?;
    let caminho = raiz.join("options.txt");
    if caminho.symlink_metadata().is_ok() {
        validar_caminho_dentro_raiz(&raiz, &caminho)?;
    }
    Ok(caminho)
}

fn ler_opcoes(caminho: &Path) -> Result<String, String> {
    match std::fs::read_to_string(caminho) {
        Ok(texto) => Ok(texto),
        Err(erro) if erro.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(erro) => Err(format!("Não foi possível ler as opções do jogo: {erro}")),
    }
}

fn opcao_booleana(chave: &str) -> bool {
    matches!(chave, "fullscreen" | "autoJump" | "invertYMouse")
}

fn limites_opcao(chave: &str) -> Option<(f64, f64, bool)> {
    Some(match chave {
        "renderDistance" => (2.0, 64.0, true),
        "maxFps" => (0.0, 260.0, true),
        "guiScale" => (0.0, 16.0, true),
        "fov" => (-1.0, 1.0, false),
        "gamma"
        | "mouseSensitivity"
        | "soundCategory_master"
        | "soundCategory_music"
        | "sound"
        | "music" => (0.0, 1.0, false),
        _ => return None,
    })
}

fn valor_valido(chave: &str, valor: &str) -> bool {
    if opcao_booleana(chave) {
        return matches!(valor, "true" | "false");
    }
    let Some(limites) = limites_opcao(chave) else {
        return false;
    };
    valor.parse::<f64>().is_ok_and(|numero| {
        numero.is_finite()
            && numero >= limites.0
            && numero <= limites.1
            && (!limites.2 || numero.fract() == 0.0)
    })
}

fn extrair_opcoes(texto: &str) -> OpcoesJogo {
    texto
        .lines()
        .filter_map(|linha| {
            let (chave, valor) = linha.split_once(':')?;
            valor_valido(chave, valor).then(|| (chave.to_string(), valor.to_string()))
        })
        .collect()
}

fn aplicar_opcoes(texto: &str, alteracoes: &OpcoesJogo) -> Result<String, String> {
    for (chave, valor) in alteracoes {
        let restaurar_padrao =
            valor.is_empty() && (opcao_booleana(chave) || limites_opcao(chave).is_some());
        if !restaurar_padrao && !valor_valido(chave, valor) {
            return Err(format!("Valor inválido para a opção {chave}."));
        }
    }
    let quebra = if texto.contains("\r\n") { "\r\n" } else { "\n" };
    let mut pendentes = alteracoes.clone();
    let mut linhas = Vec::new();
    for linha in texto.lines() {
        if let Some((chave, _)) = linha.split_once(':') {
            if let Some(valor) = alteracoes.get(chave) {
                if !valor.is_empty() {
                    linhas.push(format!("{chave}:{valor}"));
                }
                pendentes.remove(chave);
                continue;
            }
        }
        linhas.push(linha.to_string());
    }
    linhas.extend(
        pendentes
            .iter()
            .filter(|(_, valor)| !valor.is_empty())
            .map(|(chave, valor)| format!("{chave}:{valor}")),
    );
    Ok(format!("{}{quebra}", linhas.join(quebra)))
}

#[tauri::command]
pub(crate) async fn obter_configuracoes_jogo(
    instance_id: String,
    state: State<'_, LauncherState>,
) -> Result<OpcoesJogo, String> {
    let caminho = caminho_opcoes(&state, &instance_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        ler_opcoes(&caminho).map(|texto| extrair_opcoes(&texto))
    })
    .await
    .map_err(|erro| format!("Falha ao carregar opções: {erro}"))?
}

#[tauri::command]
pub(crate) async fn salvar_configuracoes_jogo(
    instance_id: String,
    alteracoes: OpcoesJogo,
    state: State<'_, LauncherState>,
) -> Result<OpcoesJogo, String> {
    if crate::comandos::instancia_sistema::is_instance_running(instance_id.clone(), state.clone())?
    {
        return Err(
            "Feche o Minecraft desta instância antes de salvar as opções do jogo.".to_string(),
        );
    }
    let caminho = caminho_opcoes(&state, &instance_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _gravacao = GRAVACAO_OPCOES
            .lock()
            .map_err(|_| "Falha ao acessar opções do jogo.".to_string())?;
        let texto = aplicar_opcoes(&ler_opcoes(&caminho)?, &alteracoes)?;
        let temporario = caminho.with_file_name(format!(".dome-opcoes-{}", uuid::Uuid::new_v4()));
        let resultado = (|| {
            std::fs::write(&temporario, &texto)
                .map_err(|erro| format!("Falha ao gravar opções: {erro}"))?;
            std::fs::rename(&temporario, &caminho)
                .map_err(|erro| format!("Falha ao salvar opções: {erro}"))?;
            Ok(extrair_opcoes(&texto))
        })();
        let _ = std::fs::remove_file(temporario);
        resultado
    })
    .await
    .map_err(|erro| format!("Falha ao salvar opções: {erro}"))?
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn restaura_padrao_sem_apagar_opcoes_desconhecidas() {
        let texto = "gamma:0.5\r\nmod:valor\r\ngamma:0.7\r\nfullscreen:true\r\n";
        let alteracoes = BTreeMap::from([
            ("gamma".into(), String::new()),
            ("fullscreen".into(), String::new()),
            ("maxFps".into(), String::new()),
        ]);
        assert_eq!(aplicar_opcoes(texto, &alteracoes).unwrap(), "mod:valor\r\n");
        assert!(aplicar_opcoes(texto, &BTreeMap::from([("mod".into(), String::new())])).is_err());
    }

    #[test]
    fn altera_apenas_opcoes_pedidas_e_preserva_configuracoes_de_mods() {
        let texto =
            "version:3700\r\nkey_key.attack:key.mouse.left\r\nmod:valor:extra\r\nfov:0.0\r\n";
        let alteracoes = BTreeMap::from([
            ("fov".into(), "0.5".into()),
            ("fullscreen".into(), "true".into()),
        ]);
        let resultado = aplicar_opcoes(texto, &alteracoes).unwrap();
        assert!(resultado.contains("key_key.attack:key.mouse.left\r\nmod:valor:extra\r\n"));
        assert!(resultado.contains("version:3700\r\n"));
        assert!(resultado.contains("fov:0.5\r\n"));
        assert!(resultado.contains("fullscreen:true\r\n"));
        assert_eq!(extrair_opcoes(&resultado), alteracoes);
        assert!(aplicar_opcoes(texto, &BTreeMap::from([("fov".into(), "NaN".into())])).is_err());
        assert!(aplicar_opcoes(
            texto,
            &BTreeMap::from([("renderDistance".into(), "2.5".into())])
        )
        .is_err());
        assert!(aplicar_opcoes(
            texto,
            &BTreeMap::from([("key_key.attack".into(), "abc".into())])
        )
        .is_err());
        assert_eq!(aplicar_opcoes("", &alteracoes).unwrap().lines().count(), 2);
    }
}
