use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FalhaPlanoInstalacaoConteudo {
    chave: String,
    nome: String,
    motivo: String,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanoInstalacaoConteudo {
    pub(super) itens: Vec<ItemPlanoInstalacaoConteudo>,
    pub(super) falhas: Vec<FalhaPlanoInstalacaoConteudo>,
}

async fn planejar_selecao(
    client: &reqwest::Client,
    selecao: &SelecaoInstalacaoConteudo,
    minecraft: &str,
    loader: &Option<String>,
) -> Result<Vec<ItemPlanoInstalacaoConteudo>, String> {
    if !matches!(
        selecao.tipo_projeto.as_str(),
        "mod" | "resourcepack" | "shader"
    ) {
        return Err(format!(
            "Tipo de conteúdo inválido: {}.",
            selecao.tipo_projeto
        ));
    }
    if selecao.id.trim().is_empty() || selecao.nome.trim().is_empty() {
        return Err("Um conteúdo selecionado não possui identificação válida.".into());
    }
    let mut itens = Vec::new();
    if selecao.tipo_projeto == "mod" {
        adicionar_mod_e_dependencias_ao_plano(client, &mut itens, selecao, minecraft, loader)
            .await?;
    } else {
        let arquivo = resolver_projeto_sem_dependencias(client, selecao, minecraft, loader).await?;
        adicionar_item_ao_plano(
            &mut itens,
            arquivo,
            &selecao.tipo_projeto,
            Some(&selecao.nome),
            selecao.icone_url.as_deref(),
            None,
        );
    }
    Ok(itens)
}

fn registrar_selecao(
    plano: &mut PlanoInstalacaoConteudo,
    selecao: &SelecaoInstalacaoConteudo,
    resultado: Result<Vec<ItemPlanoInstalacaoConteudo>, String>,
) {
    let plataforma = match selecao.plataforma {
        ModPlatform::CurseForge => "curseforge",
        ModPlatform::Modrinth => "modrinth",
        ModPlatform::Ftb => "ftb",
    };
    let chave = format!("{}:project:{}", plataforma, selecao.id);
    let itens = match resultado {
        Ok(itens) => itens,
        Err(motivo) => {
            plano.falhas.push(FalhaPlanoInstalacaoConteudo {
                chave,
                nome: selecao.nome.clone(),
                motivo,
            });
            return;
        }
    };
    for mut item in itens {
        item.selecoes.push(chave.clone());
        let Some(existente) = plano
            .itens
            .iter_mut()
            .find(|anterior| anterior.chave == item.chave)
        else {
            plano.itens.push(item);
            continue;
        };
        if !existente.selecoes.contains(&chave) {
            existente.selecoes.push(chave.clone());
        }
        for requerente in item.requerido_por {
            if !existente.requerido_por.contains(&requerente) {
                existente.requerido_por.push(requerente);
            }
        }
        if item.selecionado {
            existente.nome = item.nome;
            existente.icone_url = item.icone_url.or(existente.icone_url.take());
            existente.selecionado = true;
        }
    }
}

pub(super) async fn planejar_conteudos(
    client: &reqwest::Client,
    selecoes: Vec<SelecaoInstalacaoConteudo>,
    minecraft: &str,
    loader: &Option<String>,
) -> PlanoInstalacaoConteudo {
    let mut plano = PlanoInstalacaoConteudo::default();
    for selecao in selecoes {
        let resultado = planejar_selecao(client, &selecao, minecraft, loader).await;
        registrar_selecao(&mut plano, &selecao, resultado);
    }
    plano
}

#[cfg(test)]
mod testes {
    use super::*;

    fn selecao(id: &str) -> SelecaoInstalacaoConteudo {
        SelecaoInstalacaoConteudo {
            id: id.into(),
            nome: id.into(),
            icone_url: None,
            plataforma: ModPlatform::CurseForge,
            tipo_projeto: "mod".into(),
        }
    }

    fn item(id: &str, selecionado: bool, requerido_por: &[&str]) -> ItemPlanoInstalacaoConteudo {
        ItemPlanoInstalacaoConteudo {
            chave: format!("curseforge:project:{id}"),
            project_id: id.into(),
            nome: id.into(),
            icone_url: None,
            nome_arquivo: format!("{id}.jar"),
            download_url: "https://example.com/mod.jar".into(),
            versao: "1".into(),
            tipo_versao: "release".into(),
            plataforma: ModPlatform::CurseForge,
            tipo_projeto: "mod".into(),
            requerido_por: requerido_por.iter().map(|nome| nome.to_string()).collect(),
            selecionado,
            selecoes: Vec::new(),
        }
    }

    #[test]
    fn falha_entre_selecoes_validas_nao_descarta_plano_nem_contamina_dependencias() {
        let mut plano = PlanoInstalacaoConteudo::default();
        registrar_selecao(
            &mut plano,
            &selecao("a"),
            Ok(vec![item("lib", false, &["a"]), item("a", true, &[])]),
        );
        registrar_selecao(
            &mut plano,
            &selecao("restrito"),
            Err("Download indisponível".into()),
        );
        registrar_selecao(
            &mut plano,
            &selecao("b"),
            Ok(vec![item("lib", false, &["b"]), item("b", true, &[])]),
        );
        assert_eq!(plano.itens.len(), 3);
        assert_eq!(plano.falhas.len(), 1);
        assert_eq!(plano.falhas[0].nome, "restrito");
        assert_eq!(
            plano.itens[0].selecoes,
            ["curseforge:project:a", "curseforge:project:b"]
        );
        assert_eq!(plano.itens[0].requerido_por, ["a", "b"]);
        assert!(plano.itens.iter().all(|item| !item
            .selecoes
            .contains(&"curseforge:project:restrito".into())));
    }

    #[test]
    fn dependencia_tambem_selecionada_preserva_requerentes_e_identidade() {
        let mut plano = PlanoInstalacaoConteudo::default();
        registrar_selecao(
            &mut plano,
            &selecao("a"),
            Ok(vec![item("lib", false, &["a"]), item("a", true, &[])]),
        );
        registrar_selecao(
            &mut plano,
            &selecao("lib"),
            Ok(vec![item("lib", true, &[])]),
        );
        assert_eq!(plano.itens.len(), 2);
        assert!(plano.itens[0].selecionado);
        assert_eq!(plano.itens[0].requerido_por, ["a"]);
        assert_eq!(
            plano.itens[0].selecoes,
            ["curseforge:project:a", "curseforge:project:lib"]
        );
    }
}
