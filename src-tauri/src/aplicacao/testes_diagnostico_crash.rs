use super::*;
use std::io::{Cursor, Write};

struct Cenario(PathBuf);

impl Cenario {
    fn novo() -> Self {
        let raiz = std::env::temp_dir().join(format!("dome-crash-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(raiz.join("logs")).unwrap();
        std::fs::create_dir_all(raiz.join("mods")).unwrap();
        std::fs::create_dir_all(raiz.join("crash-reports")).unwrap();
        Self(raiz)
    }

    fn gravar(&self, nome: &str, texto: &str) {
        std::fs::write(self.0.join(nome), texto).unwrap();
    }

    fn mod_fabric(&self, id: &str, nome: &str, entradas: &[(&str, &[u8])]) {
        let json = serde_json::json!({ "id": id, "name": nome, "version": "1.0" }).to_string();
        let mut arquivos = vec![("fabric.mod.json", json.as_bytes())];
        arquivos.extend_from_slice(entradas);
        std::fs::write(
            self.0.join("mods").join(format!("{}.jar", id)),
            criar_jar(&arquivos),
        )
        .unwrap();
    }

    fn diagnosticar(&self, texto: &str) -> DiagnosticoCrash {
        let sessao = SessaoLogs::preparar(&self.0);
        self.gravar("logs/latest.log", texto);
        sessao.analisar("teste", Some(false), Some(1))
    }
}

impl Drop for Cenario {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn criar_jar(entradas: &[(&str, &[u8])]) -> Vec<u8> {
    let mut compactado = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (nome, bytes) in entradas {
        compactado
            .start_file(*nome, zip::write::SimpleFileOptions::default())
            .unwrap();
        compactado.write_all(bytes).unwrap();
    }
    compactado.finish().unwrap().into_inner()
}

#[test]
fn fechamento_normal_com_erros_recuperados_nao_e_crash() {
    let cenario = Cenario::novo();
    let sessao = SessaoLogs::preparar(&cenario.0);
    cenario.gravar(
        "logs/latest.log",
        "[Render thread/ERROR]: Resource reload failed\n\
        java.lang.NullPointerException\n[Render thread/INFO]: Stopping!",
    );
    let resultado = sessao.analisar("teste", Some(true), Some(0));
    assert_eq!(resultado.estado, "normal");
    assert!(resultado.mods.is_empty());
}

#[test]
fn relatorio_antigo_nao_contamina_execucao_nova() {
    let cenario = Cenario::novo();
    cenario.gravar(
        "crash-reports/crash-antigo-client.txt",
        "---- Minecraft Crash Report ----\n\
        Could not execute entrypoint stage 'main', provided by 'antigo'!",
    );
    cenario.gravar(
        "logs/latest.log",
        "Encountered an unexpected exception\n\
        Could not execute entrypoint stage 'main', provided by 'antigo'!\n",
    );
    cenario.mod_fabric("antigo", "Mod antigo", &[]);
    let sessao = SessaoLogs::preparar(&cenario.0);
    let mut arquivo = std::fs::OpenOptions::new()
        .append(true)
        .open(cenario.0.join("logs/latest.log"))
        .unwrap();
    writeln!(arquivo, "[main/INFO]: Iniciando nova sessão").unwrap();
    let resultado = sessao.analisar("teste", Some(false), Some(1));
    assert_eq!(resultado.estado, "crash");
    assert!(resultado.mods.is_empty());
    assert_eq!(resultado.resumo, "A origem do crash não foi encontrada.");
    assert_eq!(
        sessao.analisar("teste", Some(true), Some(0)).estado,
        "normal"
    );
}

#[test]
fn identifica_entrypoint_fabric_sem_acusar_ids_semelhantes() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("teste", "Mod Teste", &[]);
    cenario.mod_fabric("teste_extra", "Outro", &[]);
    let resultado = cenario.diagnosticar(
        "Could not execute entrypoint stage 'client' due to errors, provided by 'teste'!",
    );
    assert_eq!(resultado.mods.len(), 1);
    assert_eq!(resultado.mods[0].nome, "Mod Teste");
    assert_eq!(resultado.mods[0].confianca, "alta");
}

#[test]
fn prioriza_causa_profunda_sobre_entrypoint_e_ignora_lista_de_mods() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("fachada", "Fachada", &[("exemplo/Fachada.class", b"")]);
    cenario.mod_fabric("biblioteca", "Biblioteca", &[("lib/Falha.class", b"")]);
    let resultado = cenario.diagnosticar(
        "Could not execute entrypoint stage 'main', provided by 'fachada'!\n\
        \tat exemplo.Fachada.iniciar(Fachada.java:1)\n\
        Caused by: java.lang.NullPointerException\n\
        \tat lib.Falha.executar(Falha.java:2)\n\
        \tat exemplo.Fachada.iniciar(Fachada.java:1)\n\
        -- System Details --\n\
        Could not execute entrypoint stage 'main', provided by 'fachada'!",
    );
    assert_eq!(resultado.mods[0].nome, "Biblioteca");
    assert_eq!(resultado.mods[0].confianca, "média");
    assert_eq!(resultado.mods[1].nome, "Fachada");
    assert_eq!(resultado.mods[1].relacao, Some("chamada"));
}

#[test]
fn crash_real_survive_preserva_unionlib_e_a_chamada_do_survive() {
    let cenario = Cenario::novo();
    cenario.mod_fabric(
        "survive",
        "Survive",
        &[("com/stereowalker/survive/world/item/SItems.class", b"")],
    );
    cenario.mod_fabric(
        "unionlib",
        "UnionLib",
        &[("com/stereowalker/unionlib/util/VersionHelper.class", b"")],
    );
    cenario.mod_fabric("inocente", "Inocente", &[]);
    let resultado = cenario.diagnosticar(include_str!("fixtures/crash-survive-unionlib.txt"));
    assert_eq!(resultado.mods.len(), 2);
    assert_eq!(resultado.mods[0].nome, "UnionLib");
    assert_eq!(resultado.mods[0].relacao, None);
    assert_eq!(resultado.mods[1].nome, "Survive");
    assert_eq!(resultado.mods[1].relacao, Some("chamada"));
    assert!(resultado.mods[1].evidencias[0].contains("SItems.<clinit>"));
}

#[test]
fn crash_real_de_mixin_separa_autor_e_alvo_sem_culpar_etf() {
    let cenario = Cenario::novo();
    cenario.mod_fabric(
        "emf_compat_core",
        "EMF Compat: Core",
        &[("emf_compat_core.mixins.json", b"{}")],
    );
    cenario.mod_fabric(
        "entity_model_features",
        "Entity Model Features",
        &[
            ("entity_model_features.mixins.json", b"{}"),
            (
                "traben/entity_model_features/models/parts/EMFModelPartRoot.class",
                b"",
            ),
        ],
    );
    cenario.mod_fabric("entity_texture_features", "Entity Texture Features", &[]);
    let resultado = cenario.diagnosticar(include_str!("fixtures/crash-emf-compat.txt"));
    assert_eq!(resultado.mods.len(), 2);
    assert_eq!(resultado.mods[0].nome, "EMF Compat: Core");
    assert_eq!(resultado.mods[0].relacao, None);
    assert_eq!(resultado.mods[1].nome, "Entity Model Features");
    assert_eq!(resultado.mods[1].relacao, Some("alvoMixin"));
}

#[test]
fn anotacoes_de_mixins_aplicados_na_pilha_nao_sao_falhas_desses_mods() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("emf", "EMF", &[]);
    cenario.mod_fabric(
        "etf",
        "ETF",
        &[("entity_texture_features.mixins.json", b"{}")],
    );
    cenario.mod_fabric("atlas", "Atlas", &[("antiqueatlas.mixins.json", b"{}")]);
    let resultado = cenario.diagnosticar(
        "---- Minecraft Crash Report ----\nDescription: Mod loading error\n\
        at net.minecraft.Renderer.render(Renderer.java:1) {pl:mixin:APP:entity_texture_features.mixins.json:Renderer,pl:mixin:APP:antiqueatlas.mixins.json:Renderer}\n\
        A detailed walkthrough\n-- MOD emf --\nMod File: /mods/emf.jar\nFailure message: Inicialização falhou\n-- System Details --",
    );
    assert_eq!(resultado.mods.len(), 1);
    assert_eq!(resultado.mods[0].nome, "EMF");
}

#[test]
fn chamadas_depois_do_despacho_do_loader_nao_entram_na_relacao() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("origem", "Origem", &[("origem/Falha.class", b"")]);
    cenario.mod_fabric("outro", "Outro", &[("outro/Entrada.class", b"")]);
    let resultado = cenario.diagnosticar(
        "Encountered an unexpected exception\nCaused by: java.lang.NullPointerException\n\
        at origem.Falha.iniciar(Falha.java:1)\nat loader.Despacho.executar(Despacho.java:1)\n\
        at outro.Entrada.iniciar(Entrada.java:1)",
    );
    assert_eq!(resultado.mods.len(), 1);
}

/// Reanalisa capturas locais com os JARs reais, sem iniciar o jogo ou alterar as instâncias.
#[test]
#[ignore = "requer um corpus local indicado por DOME_CORPUS_CRASH"]
fn reanalisa_corpus_local_com_mods_reais() {
    #[derive(serde::Deserialize)]
    struct Captura {
        raiz: PathBuf,
        log: String,
        principais: Vec<String>,
        relacionados: Vec<(String, String)>,
    }
    let caminho = std::env::var_os("DOME_CORPUS_CRASH").expect("Informe DOME_CORPUS_CRASH");
    let capturas: Vec<Captura> = serde_json::from_slice(&std::fs::read(caminho).unwrap()).unwrap();
    assert!(!capturas.is_empty());
    for captura in capturas {
        let bytes = std::fs::read(captura.raiz.join(&captura.log)).unwrap();
        let texto = String::from_utf8_lossy(&bytes).into_owned();
        let resultado =
            super::super::origem_crash::identificar_origem(&captura.raiz, &[(captura.log, texto)]);
        let mut principais = resultado
            .mods
            .iter()
            .filter(|item| item.relacao.is_none())
            .map(|item| item.nome.clone())
            .collect::<Vec<_>>();
        let mut relacionados = resultado
            .mods
            .iter()
            .filter_map(|item| {
                item.relacao
                    .map(|relacao| (item.nome.clone(), relacao.to_string()))
            })
            .collect::<Vec<_>>();
        let mut esperados = captura.principais;
        let mut relacoes_esperadas = captura.relacionados;
        principais.sort();
        relacionados.sort();
        esperados.sort();
        relacoes_esperadas.sort();
        assert_eq!(principais, esperados, "{}", captura.raiz.display());
        assert_eq!(
            relacionados,
            relacoes_esperadas,
            "{}",
            captura.raiz.display()
        );
        println!(
            "{}: {}",
            captura.raiz.display(),
            serde_json::to_string(&resultado.mods).unwrap()
        );
    }
}

#[test]
fn identifica_mixin_de_biblioteca_embutida_no_jar_pai() {
    let cenario = Cenario::novo();
    let interno = criar_jar(&[
        (
            "fabric.mod.json",
            br#"{"id":"embutida","name":"Biblioteca embutida"}"#,
        ),
        ("embutida.mixins.json", b"{}"),
    ]);
    cenario.mod_fabric(
        "pai",
        "Mod Pai",
        &[("META-INF/jars/embutida.jar", &interno)],
    );
    let resultado = cenario.diagnosticar("Encountered an unexpected exception\n\
        Caused by: org.spongepowered.asm.mixin.injection.throwables.InjectionError: embutida.mixins.json:Exemplo");
    assert_eq!(resultado.mods[0].nome, "Biblioteca embutida");
    assert_eq!(resultado.mods[0].arquivo, "pai.jar");
}

#[test]
fn avisos_de_mixin_e_refmap_nao_sao_evidencia_causal() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("teste", "Teste", &[("teste.mixins.json", b"{}")]);
    let resultado = cenario.diagnosticar(
        "[main/WARN]: Error loading teste.mixins.json refmap\n\
        Encountered an unexpected exception\n\
        java.lang.IllegalStateException: sem origem\n\
        [main/WARN]: Mixin from mod teste teste.mixins.json",
    );
    assert!(resultado.mods.is_empty());
}

#[test]
fn falha_nativa_e_memoria_nao_sao_atribuidas_a_mods() {
    let cenario = Cenario::novo();
    for (texto, origem) in [
        ("Encountered an unexpected exception\njava.lang.OutOfMemoryError: Java heap space", "memória insuficiente"),
        ("# A fatal error has been detected by the Java Runtime Environment\n# EXCEPTION_ACCESS_VIOLATION", "falha nativa"),
        ("Error occurred during initialization of VM\nCould not reserve enough space for object heap", "memória insuficiente"),
        ("Exception in thread main java.lang.UnsupportedClassVersionError", "Java incompatível"),
    ] {
        let resultado = cenario.diagnosticar(texto);
        assert!(resultado.origem.as_ref().unwrap().contains(origem));
        assert!(resultado.mods.is_empty());
    }
}

#[test]
fn le_saida_do_java_mesmo_sem_latest_log() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("teste", "Teste", &[]);
    cenario.gravar("logs/dome-console.log", "Saída da execução anterior");
    let sessao = SessaoLogs::preparar(&cenario.0);
    cenario.gravar(
        "logs/dome-console.log",
        "Could not execute entrypoint stage 'main', provided by 'teste'!",
    );
    let resultado = sessao.analisar("teste", Some(false), Some(1));
    assert_eq!(resultado.mods[0].nome, "Teste");
}

#[test]
fn forge_neoforge_quilt_e_forge_legado_usam_metadados_locais() {
    for (nome, metadados) in [
        (
            "META-INF/neoforge.mods.toml",
            "[[mods]]\nmodId = 'teste'\ndisplayName = 'Teste'\nversion = '1'",
        ),
        (
            "META-INF/mods.toml",
            "[[mods]]\nmodId = 'teste'\ndisplayName = 'Teste'\nversion = '1'",
        ),
        (
            "quilt.mod.json",
            r#"{"quilt_loader":{"id":"teste","metadata":{"name":"Teste"}}}"#,
        ),
        (
            "mcmod.info",
            r#"[{"modid":"teste","name":"Teste","version":"1"}]"#,
        ),
    ] {
        let cenario = Cenario::novo();
        std::fs::write(
            cenario.0.join("mods/teste.jar"),
            criar_jar(&[(nome, metadados.as_bytes())]),
        )
        .unwrap();
        let resultado = cenario.diagnosticar("---- Minecraft Crash Report ----\nDescription: Mod loading error\n\
            A detailed walkthrough of the error\n-- MOD teste --\nDetails:\n\
            Mod File: /instancia/mods/teste.jar\nFailure message: Falha ao carregar\n-- System Details --");
        assert_eq!(resultado.mods[0].nome, "Teste", "{}", nome);
    }
}

#[test]
fn mods_desativados_nao_recebem_culpa_e_jar_invalido_nao_interrompe_analise() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("desativado", "Desativado", &[]);
    std::fs::rename(
        cenario.0.join("mods/desativado.jar"),
        cenario.0.join("mods/desativado.jar.disabled"),
    )
    .unwrap();
    std::fs::write(cenario.0.join("mods/invalido.jar"), "não é um zip").unwrap();
    let resultado = cenario
        .diagnosticar("Could not execute entrypoint stage 'main', provided by 'desativado'!");
    assert!(resultado.mods.is_empty());
    assert!(!resultado.avisos.is_empty());
}

#[test]
fn dois_mods_com_mesma_evidencia_permanecem_como_candidatos() {
    let cenario = Cenario::novo();
    cenario.mod_fabric("um", "Um", &[("comum.mixins.json", b"{}")]);
    cenario.mod_fabric("dois", "Dois", &[("comum.mixins.json", b"{}")]);
    let resultado = cenario.diagnosticar(
        "Encountered an unexpected exception\n\
        Caused by: InjectionError: comum.mixins.json:Classe",
    );
    assert_eq!(resultado.mods.len(), 2);
}

#[test]
fn parada_pelo_launcher_nao_vira_crash_e_sessao_nova_descarta_resultado_antigo() {
    let estado = EstadoDiagnosticos::default();
    estado.iniciar("teste", 10);
    assert!(estado.encerrar_pelo_usuario("teste", 10, || true));
    let crash = DiagnosticoCrash::novo("teste", "crash", "Falhou", Some(1));
    assert_eq!(
        estado.concluir(10, crash.clone()).unwrap().estado,
        "interrompido"
    );
    estado.iniciar("teste", 11);
    assert!(estado.concluir(10, crash.clone()).is_none());
    assert!(!estado.encerrar_pelo_usuario("teste", 11, || false));
    assert_eq!(estado.concluir(11, crash).unwrap().estado, "crash");
}

#[test]
fn falha_de_monitoramento_nao_confirma_crash() {
    let cenario = Cenario::novo();
    let sessao = SessaoLogs::preparar(&cenario.0);
    assert_eq!(sessao.analisar("teste", None, None).estado, "indeterminado");
}

#[test]
fn relatorio_novo_detecta_crash_com_saida_zero_e_relatorio_recuperado_respeita_parada() {
    let cenario = Cenario::novo();
    let sessao = SessaoLogs::preparar(&cenario.0);
    cenario.gravar(
        "crash-reports/crash-atual-client.txt",
        "---- Minecraft Crash Report ----\njava.lang.Exception",
    );
    assert_eq!(
        sessao.analisar("teste", Some(true), Some(0)).estado,
        "crash"
    );
    cenario.gravar("logs/latest.log", "[Render thread/INFO]: Stopping!");
    assert_eq!(
        sessao.analisar("teste", Some(true), Some(0)).estado,
        "normal"
    );
}

#[test]
fn erro_de_carregamento_forge_continua_sendo_crash_ao_fechar_tela_com_saida_zero() {
    let cenario = Cenario::novo();
    let metadados =
        b"[[mods]]\nmodId = 'antiqueatlas'\ndisplayName = 'Antique Atlas'\nversion = '8.0.1'";
    let nome_jar = "Antique Atlas-1.20.1-8.0.1-Forge.jar";
    std::fs::write(
        cenario.0.join("mods").join(nome_jar),
        criar_jar(&[("META-INF/mods.toml", metadados)]),
    )
    .unwrap();
    let sessao = SessaoLogs::preparar(&cenario.0);
    cenario.gravar(
        "crash-reports/crash-carregamento-fml.txt",
        "---- Minecraft Crash Report ----\nDescription: Mod loading error has occurred\n\
        java.lang.Exception: Mod Loading has failed\n\
        A detailed walkthrough of the error\n-- MOD antiqueatlas --\nDetails:\n\
        Mod File: mods/Antique Atlas-1.20.1-8.0.1-Forge.jar\n\
        Failure message: Mod antiqueatlas requires unionlib 12.0.18 or above, and below 12.1.0\n\
        Currently, unionlib is not installed\n-- System Details --",
    );
    cenario.gravar(
        "logs/latest.log",
        "[Render thread/INFO] [minecraft/Minecraft]: Stopping!\n",
    );
    let resultado = sessao.analisar("teste", Some(true), Some(0));
    assert_eq!(resultado.estado, "crash");
    assert_eq!(resultado.codigo_saida, Some(0));
    assert_eq!(resultado.mods[0].nome, "Antique Atlas");
    assert_eq!(resultado.mods[0].arquivo, nome_jar);

    let nova_sessao = SessaoLogs::preparar(&cenario.0);
    assert_eq!(
        nova_sessao.analisar("teste", Some(true), Some(0)).estado,
        "normal"
    );
}
