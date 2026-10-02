import { SelecaoConteudoModpack } from './SelecaoConteudoModpack';
import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { consultarModpacksDome } from '../../services/modpacksDome';
import { EVENTO_SESSAO_SOCIAL_ATUALIZADA } from '../../lib/autenticacaoMicrosoft';
import { obterImagemProjeto } from '../../lib/imagemProjeto';
import { Package, Plus, X, Loader2, ArrowLeft, ChevronRight, Trash2 } from '../../iconesPixelados';
import {
    EVENTO_ABRIR_MEUS_MODPACKS,
    EVENTO_PUBLICAR_MODPACK_DOME,
    type PedidoPublicacaoModpack,
} from '../../lib/eventosModpacksDome';
import { CamposVersaoModpack, CamposConteudoModpack } from './CamposVersaoModpack';
import { CamposApresentacaoModpack } from './CamposApresentacaoModpack';
import './PublicadorModpacks.css';
import { useEditorModpacks } from './useEditorModpacks';
import { ConfirmacaoExclusaoModpack } from './ConfirmacaoExclusaoModpack';

const classeCampo = 'modpacks-campo';
const classeBotao = 'modpacks-botao';
const mensagemErro = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

export function PublicadorModpacks() {
    const [permitido, setPermitido] = useState(false);
    useEffect(() => {
        let ativo = true;
        const verificar = () =>
            consultarModpacksDome<{ permitido: boolean }>('permissao')
                .then((resposta) => {
                    if (ativo) setPermitido(resposta.permitido);
                })
                .catch(() => {
                    if (ativo) setPermitido(false);
                });
        void verificar();
        window.addEventListener(EVENTO_SESSAO_SOCIAL_ATUALIZADA, verificar);
        return () => {
            ativo = false;
            window.removeEventListener(EVENTO_SESSAO_SOCIAL_ATUALIZADA, verificar);
        };
    }, []);
    if (!permitido) return null;
    return (
        <>
            <div className="flex justify-end">
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_MEUS_MODPACKS))}
                    className={classeBotao}
                >
                    <Package size={14} className="mr-2 inline" /> Meus modpacks{' '}
                    <span className="ml-2 text-xs text-sky-300">beta</span>
                </button>
            </div>
        </>
    );
}

export function PublicadorModpacksGlobal() {
    const [pedido, setPedido] = useState<PedidoPublicacaoModpack | null>(null);
    useEffect(() => {
        const abrir = (evento: Event) => {
            const detalhe = (evento as CustomEvent<PedidoPublicacaoModpack>).detail;
            if (detalhe?.instanciaId) setPedido(detalhe);
        };
        window.addEventListener(EVENTO_PUBLICAR_MODPACK_DOME, abrir);
        return () => window.removeEventListener(EVENTO_PUBLICAR_MODPACK_DOME, abrir);
    }, []);
    if (!pedido) return null;
    return <EditorModpacks pedido={pedido} modal onFechar={() => setPedido(null)} />;
}

const PEDIDO_PAGINA: PedidoPublicacaoModpack = {};
const fecharPagina = () => undefined;

export function PaginaMeusModpacks() {
    return <EditorModpacks pedido={PEDIDO_PAGINA} onFechar={fecharPagina} />;
}

function EditorModpacks({
    pedido,
    onFechar,
    modal = false,
}: {
    pedido: PedidoPublicacaoModpack;
    onFechar: () => void;
    modal?: boolean;
}) {
    const {
        previaConteudo,
        arquivosSelecionados,
        setArquivosSelecionados,
        carregandoArquivos,
        projetos,
        selecionado,
        nome,
        descricao,
        corpo,
        foto,
        numero,
        notas,
        canal,
        caminho,
        instancias,
        instanciaId,
        versoes,
        ocupado,
        erro,
        sucesso,
        carregando,
        permitido,
        painelRef,
        criando,
        aba,
        novaVersao,
        busca,
        setNumero,
        setNotas,
        setCanal,
        setNome,
        setDescricao,
        setCorpo,
        setCriando,
        setAba,
        setNovaVersao,
        setBusca,
        setErro,
        setSucesso,
        selecionar,
        salvar,
        publicar,
        escolherArquivo,
        escolherFoto,
        setOcupado,
        selecionarInstancia,
        retirar,
        exclusao,
        pedirExclusao,
        cancelarExclusao,
        excluir,
        avancar,
        etapas,
        indiceEtapa,
    } = useEditorModpacks(pedido, modal, onFechar);
    const selecaoArquivos = instanciaId ? (
        <SelecaoConteudoModpack
            previa={previaConteudo?.instanciaId === instanciaId ? previaConteudo.previa : undefined}
            selecionados={arquivosSelecionados}
            onAlterar={setArquivosSelecionados}
            carregando={carregandoArquivos}
        />
    ) : null;
    const camposVersao = (
        <CamposVersaoModpack
            numero={numero}
            setNumero={setNumero}
            canal={canal}
            setCanal={setCanal}
            instanciaId={instanciaId}
            instancias={instancias}
            caminho={caminho}
            notas={notas}
            setNotas={setNotas}
            selecionarInstancia={(id) => {
                const instancia = instancias.find((item) => item.id === id);
                if (instancia) selecionarInstancia(instancia);
            }}
            escolherArquivo={() => void escolherArquivo().catch((falha) => setErro(mensagemErro(falha)))}
        />
    );
    const apresentacao = (
        <CamposApresentacaoModpack
            aba={aba}
            nome={nome}
            setNome={setNome}
            descricao={descricao}
            setDescricao={setDescricao}
            corpo={corpo}
            setCorpo={setCorpo}
            foto={foto ?? selecionado?.icon_url}
            escolherFoto={escolherFoto}
            aoOcupado={setOcupado}
        />
    );
    const feedback = (
        <>
            {erro && (
                <p role="alert" className="modpacks-erro">
                    {erro}
                </p>
            )}
            {sucesso && (
                <p role="status" className="modpacks-sucesso">
                    {sucesso}
                </p>
            )}
            {ocupado && (
                <p role="status" className="modpacks-progresso">
                    <Loader2 size={15} className="animate-spin" />
                    {exclusao ? 'Excluindo...' : 'Preparando e enviando...'}
                </p>
            )}
        </>
    );

    const conteudo = (
        <section className="modpacks-pagina">
            {exclusao && (
                <ConfirmacaoExclusaoModpack
                    titulo={exclusao.versao ? `Excluir versão ${exclusao.versao.version_number}?`
                        : `Excluir ${exclusao.projeto.title}?`}
                    descricao={exclusao.versao
                        ? 'Esta versão será removida e não poderá mais ser baixada. Instalações existentes permanecem. '
                            + 'Se for a última versão, o projeto ficará como rascunho. Esta ação não pode ser desfeita.'
                        : 'O projeto e todas as suas versões serão removidos. Instalações existentes permanecem. '
                            + 'Esta ação não pode ser desfeita.'}
                    ocupado={ocupado}
                    erro={erro}
                    confirmar={() => void excluir()}
                    cancelar={cancelarExclusao}
                />
            )}
            {!criando && !selecionado ? (
                <>
                    <div className="modpacks-cabecalho">
                        <div>
                            <h2>Seus projetos</h2>
                            <span className="modpacks-beta">BETA</span>
                        </div>
                        <button
                            className="modpacks-botao modpacks-botao--destaque"
                            disabled={carregando || !permitido}
                            onClick={() => selecionar(null)}
                        >
                            <Plus size={14} /> Novo modpack
                        </button>
                    </div>
                    {feedback}
                    <input
                        className={classeCampo}
                        aria-label="Buscar seus modpacks"
                        placeholder="Buscar seus modpacks..."
                        value={busca}
                        onChange={(evento) => setBusca(evento.target.value)}
                    />
                    {carregando ? (
                        <p className="modpacks-vazio">Carregando projetos...</p>
                    ) : projetos.length === 0 ? (
                        <div className="modpacks-vazio">
                            <Package size={32} />
                            <p>Seu próximo modpack começa aqui.</p>
                            <button className={classeBotao} disabled={!permitido} onClick={() => selecionar(null)}>
                                Criar primeiro modpack
                            </button>
                        </div>
                    ) : (
                        <div className="modpacks-projetos">
                            {projetos
                                .filter((projeto) => projeto.title.toLowerCase().includes(busca.toLowerCase()))
                                .map((projeto) => (
                                    <div className="modpacks-projeto-cartao" key={projeto.id}>
                                        <button
                                            className="modpacks-projeto"
                                            disabled={ocupado}
                                            onClick={() => selecionar(projeto)}
                                        >
                                            <img src={obterImagemProjeto(projeto.icon_url, 'modpack', projeto.id)} alt="" />
                                            <div>
                                                <strong>{projeto.title}</strong>
                                                <p>{projeto.description}</p>
                                            </div>
                                            <ChevronRight size={16} />
                                        </button>
                                        <button
                                            className="modpacks-excluir-projeto"
                                            disabled={ocupado || !permitido}
                                            aria-label={`Excluir projeto ${projeto.title}`}
                                            title="Excluir projeto"
                                            onClick={() => pedirExclusao(projeto)}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                        </div>
                    )}
                </>
            ) : (
                <>
                    {!modal && (
                        <button
                            className="modpacks-voltar"
                            disabled={ocupado}
                            onClick={() => {
                                selecionar(null);
                                setCriando(false);
                            }}
                        >
                            <ArrowLeft size={14} /> Seus projetos
                        </button>
                    )}
                    <div className="modpacks-cabecalho">
                        <div>
                            <h2>{selecionado?.title ?? 'Novo modpack'}</h2>
                            <span className="modpacks-beta">BETA</span>
                        </div>
                        {!selecionado && (
                            <span className="modpacks-etapa">
                                {indiceEtapa + 1} / {etapas.length}
                            </span>
                        )}
                    </div>
                    <nav
                        className="modpacks-abas"
                        aria-label={selecionado ? 'Gerenciar modpack' : 'Etapas da publicação'}
                    >
                        {etapas.map((item, indice) => (
                            <button
                                key={item.id}
                                type="button"
                                disabled={
                                    ocupado ||
                                    carregando ||
                                    (!selecionado && item.id !== 'conteudo' && !caminho && !instanciaId)
                                }
                                aria-current={aba === item.id ? 'step' : undefined}
                                onClick={() => {
                                    setAba(item.id);
                                    setErro('');
                                }}
                                className={aba === item.id ? 'ativa' : ''}
                            >
                                {!selecionado && <span>{indice + 1}</span>}
                                {item.nome}
                            </button>
                        ))}
                    </nav>
                    {feedback}
                    <div className="modpacks-painel">
                        {!selecionado ? (
                            <form
                                onSubmit={(evento) => {
                                    if (aba === 'revisao') void salvar(evento);
                                    else {
                                        evento.preventDefault();
                                        avancar();
                                    }
                                }}
                            >
                                <fieldset disabled={ocupado || carregando || !permitido}>
                                    {(aba === 'informacoes' || aba === 'descricao') && apresentacao}
                                    {aba === 'conteudo' && (
                                        <>
                                            <CamposConteudoModpack
                                                instanciaId={instanciaId}
                                                instancias={instancias}
                                                caminho={caminho}
                                                selecionarInstancia={(id) => {
                                                    const instancia = instancias.find((item) => item.id === id);
                                                    if (instancia) selecionarInstancia(instancia);
                                                }}
                                                escolherArquivo={() =>
                                                    void escolherArquivo().catch((falha) =>
                                                        setErro(mensagemErro(falha)),
                                                    )
                                                }
                                            />
                                            {selecaoArquivos}
                                        </>
                                    )}
                                    {aba === 'versao' && (
                                        <CamposVersaoModpack
                                            numero={numero}
                                            setNumero={setNumero}
                                            canal={canal}
                                            setCanal={setCanal}
                                            instanciaId={instanciaId}
                                            instancias={instancias}
                                            caminho={caminho}
                                            notas={notas}
                                            setNotas={setNotas}
                                            mostrarConteudo={false}
                                            selecionarInstancia={() => undefined}
                                            escolherArquivo={() => undefined}
                                        />
                                    )}
                                    {aba === 'revisao' && (
                                        <div className="modpacks-revisao">
                                            <img src={obterImagemProjeto(foto, 'modpack', 'novo')} alt="" />
                                            <div>
                                                <h3>{nome || 'Sem nome'}</h3>
                                                <p>{descricao}</p>
                                            </div>
                                            <dl>
                                                <div>
                                                    <dt>Versão</dt>
                                                    <dd>
                                                        {numero} · {canal}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt>Conteúdo</dt>
                                                    <dd>
                                                        {instancias.find((item) => item.id === instanciaId)?.name ||
                                                            caminho.split(/[\\/]/).pop() ||
                                                            'Não selecionado'}
                                                    </dd>
                                                </div>
                                            </dl>
                                            <p className="modpacks-ajuda">
                                                O modpack ficará disponível na fonte Dome do Explorar.
                                            </p>
                                        </div>
                                    )}
                                    <div className="modpacks-acoes">
                                        {indiceEtapa > 0 && (
                                            <button
                                                type="button"
                                                className={classeBotao}
                                                onClick={() => setAba(etapas[indiceEtapa - 1].id)}
                                            >
                                                Voltar
                                            </button>
                                        )}
                                        <button type="submit" className="modpacks-botao modpacks-botao--destaque">
                                            {aba === 'revisao' ? 'Publicar modpack' : 'Continuar'}
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                </fieldset>
                            </form>
                        ) : (
                            <>
                                {(aba === 'informacoes' || aba === 'descricao') && (
                                    <form onSubmit={salvar}>
                                        <fieldset disabled={ocupado || !permitido}>
                                            {apresentacao}
                                            <div className="modpacks-acoes">
                                                <button className="modpacks-botao modpacks-botao--destaque">
                                                    Salvar alterações
                                                </button>
                                            </div>
                                        </fieldset>
                                    </form>
                                )}
                                {aba === 'versoes' && (
                                    <>
                                        {!novaVersao ? (
                                            <>
                                                <div className="modpacks-cabecalho">
                                                    <h3>Versões publicadas</h3>
                                                    <button
                                                        className={classeBotao}
                                                        disabled={ocupado || !permitido}
                                                        onClick={() => {
                                                            setNovaVersao(true);
                                                            setNumero('');
                                                            setSucesso('');
                                                        }}
                                                    >
                                                        <Plus size={14} /> Nova versão
                                                    </button>
                                                </div>
                                                {!versoes.length && (
                                                    <p className="modpacks-ajuda">Nenhuma versão publicada.</p>
                                                )}
                                                {versoes.map((versao) => (
                                                    <div className="modpacks-versao" key={versao.id}>
                                                        <strong>{versao.version_number}</strong>
                                                        <span>{versao.version_type}</span>
                                                        <small>
                                                            {versao.game_versions.join(', ')} ·{' '}
                                                            {versao.loaders.join(', ')}
                                                        </small>
                                                        <button
                                                            className="modpacks-botao modpacks-botao--perigo"
                                                            disabled={ocupado || !permitido}
                                                            aria-label={`Excluir versão ${versao.version_number}`}
                                                            onClick={() => pedirExclusao(selecionado, versao)}
                                                        >
                                                            Excluir
                                                        </button>
                                                    </div>
                                                ))}
                                            </>
                                        ) : (
                                            <form onSubmit={publicar}>
                                                <fieldset disabled={ocupado || !permitido}>
                                                    {camposVersao}
                                                    {selecaoArquivos}
                                                    <div className="modpacks-acoes">
                                                        <button
                                                            type="button"
                                                            className={classeBotao}
                                                            onClick={() => setNovaVersao(false)}
                                                        >
                                                            Cancelar
                                                        </button>
                                                        <button className="modpacks-botao modpacks-botao--destaque">
                                                            Publicar versão
                                                        </button>
                                                    </div>
                                                </fieldset>
                                            </form>
                                        )}
                                    </>
                                )}
                                {aba === 'configuracoes' && (
                                    <div>
                                        <h3>Disponibilidade</h3>
                                        <p className="modpacks-ajuda">
                                            Retirar bloqueia novos downloads. Instalações existentes permanecem.
                                        </p>
                                        <button
                                            type="button"
                                            className="modpacks-botao modpacks-botao--perigo"
                                            disabled={ocupado || !permitido || !selecionado.publicado}
                                            onClick={() => void retirar()}
                                        >
                                            {selecionado.publicado ? 'Retirar do Explorar' : 'Retirado do Explorar'}
                                        </button>
                                        <div className="modpacks-exclusao-configuracoes">
                                            <button
                                                className="modpacks-botao modpacks-botao--perigo"
                                                disabled={ocupado || !permitido}
                                                onClick={() => pedirExclusao(selecionado)}
                                            >
                                                Excluir projeto
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </>
            )}
        </section>
    );

    if (!modal) return conteudo;
    return createPortal(
        <div
            className="modpacks-fundo-modal"
            ref={painelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-publicador"
        >
            <div className="modpacks-modal">
                <header>
                    <h2 id="titulo-publicador">Publicar modpack</h2>
                    <button aria-label="Fechar" disabled={ocupado} onClick={onFechar} className={classeBotao}>
                        <X size={16} />
                    </button>
                </header>
                <div className="modpacks-modal-conteudo">{conteudo}</div>
            </div>
        </div>,
        document.body,
    );
}
