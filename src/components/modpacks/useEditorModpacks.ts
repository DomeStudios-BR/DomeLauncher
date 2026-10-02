import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { consultarModpacksDome, type ModpackDome, type VersaoModpackDome } from '../../services/modpacksDome';
import { CONFIGURACAO_SOCIAL } from '../../lib/configuracaoSocial';
import type { PedidoPublicacaoModpack } from '../../lib/eventosModpacksDome';
import { caminhoPublicavel } from './SelecaoConteudoModpack';
import { converterIconeModpack } from './iconeModpack';
import type { PreviaPacoteSocial } from '../social/TransferenciasSociais';
import type { Instance } from '../../hooks/useLauncher';

type PedidoExclusao = { projeto: ModpackDome; versao?: VersaoModpackDome };

const mensagemErro = (erro: unknown) => (erro instanceof Error ? erro.message : String(erro));

export function useEditorModpacks(pedido: PedidoPublicacaoModpack, modal: boolean, onFechar: () => void) {
    const [projetos, setProjetos] = useState<ModpackDome[]>([]);
    const [selecionado, setSelecionado] = useState<ModpackDome | null>(null);
    const [nome, setNome] = useState(pedido.nome ?? '');
    const [descricao, setDescricao] = useState('');
    const [corpo, setCorpo] = useState('');
    const [foto, setFoto] = useState<string>();
    const [numero, setNumero] = useState('1.0.0');
    const [notas, setNotas] = useState('');
    const [canal, setCanal] = useState('release');
    const [caminho, setCaminho] = useState('');
    const [previaConteudo, setPreviaConteudo] = useState<{ instanciaId: string; previa: PreviaPacoteSocial } | null>(
        null,
    );
    const [arquivosSelecionados, setArquivosSelecionados] = useState(new Set<string>());
    const [carregandoArquivos, setCarregandoArquivos] = useState(false);
    const [instancias, setInstancias] = useState<Instance[]>([]);
    const [instanciaId, setInstanciaId] = useState(pedido.instanciaId ?? '');
    const [versoes, setVersoes] = useState<VersaoModpackDome[]>([]);
    const [ocupado, setOcupado] = useState(false);
    const [erro, setErro] = useState('');
    const [sucesso, setSucesso] = useState('');
    const [carregando, setCarregando] = useState(true);
    const [permitido, setPermitido] = useState(false);
    const [criando, setCriando] = useState(modal);
    const [aba, setAba] = useState('conteudo');
    const [novaVersao, setNovaVersao] = useState(false);
    const [busca, setBusca] = useState('');
    const [exclusao, setExclusao] = useState<PedidoExclusao | null>(null);
    const painelRef = useRef<HTMLDivElement>(null);
    const ocupadoRef = useRef(false);
    const selecaoFotoRef = useRef(0);
    const fotoPreparadaRef = useRef<Promise<string | undefined> | null>(null);
    ocupadoRef.current = ocupado;

    useEffect(() => {
        if (!modal) return;
        const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const overflowAnterior = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const painel = painelRef.current;
        painel?.focus();
        const aoPressionar = (evento: KeyboardEvent) => {
            if (document.querySelector('dialog[open]')) return;
            if (document.querySelector('[data-editor-icone-modpack]')) return;
            if (evento.key === 'Escape' && !ocupadoRef.current) onFechar();
            if (evento.key !== 'Tab' || !painel) return;
            const controles = Array.from(
                painel.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [contenteditable="true"]',
                ),
            ).filter((elemento) => elemento.offsetParent !== null);
            const primeiro = controles[0];
            const ultimo = controles[controles.length - 1];
            if (evento.shiftKey && (document.activeElement === primeiro || document.activeElement === painel)) {
                evento.preventDefault();
                ultimo?.focus();
            } else if (!evento.shiftKey && (document.activeElement === ultimo || document.activeElement === painel)) {
                evento.preventDefault();
                primeiro?.focus();
            }
        };
        document.addEventListener('keydown', aoPressionar);
        return () => {
            document.removeEventListener('keydown', aoPressionar);
            document.body.style.overflow = overflowAnterior;
            anterior?.focus();
        };
    }, [onFechar, modal]);

    useEffect(() => {
        let ativo = true;
        void Promise.all([
            consultarModpacksDome<ModpackDome[]>('meus'),
            invoke<Instance[]>('get_instances'),
            consultarModpacksDome<{ permitido: boolean }>('permissao'),
        ])
            .then(async ([lista, locais, permissao]) => {
                const elegiveis = await Promise.all(
                    locais.map(async (instancia) => {
                        const modpack = await invoke<{ source: string } | null>('get_modpack_info', {
                            instanceId: instancia.id,
                        });
                        return modpack ? null : instancia;
                    }),
                );
                const proprias = elegiveis.filter((instancia): instancia is Instance => instancia !== null);
                if (ativo) {
                    setProjetos(lista);
                    setInstancias(proprias);
                    const inicial = proprias.find((instancia) => instancia.id === pedido.instanciaId);
                    if (inicial) selecionarInstancia(inicial);
                    else if (pedido.instanciaId) {
                        setInstanciaId('');
                        setNome('');
                        setErro('Modpacks já publicados não podem ser republicados. Escolha uma instância própria.');
                    }
                    setPermitido(permissao.permitido);
                    if (!permissao.permitido) setErro('Publicação em beta. Peça a liberação no painel admin.');
                }
            })
            .catch((falha) => {
                if (ativo) setErro(mensagemErro(falha));
            })
            .finally(() => {
                if (ativo) setCarregando(false);
            });
        return () => {
            ativo = false;
        };
    }, []);

    useEffect(() => {
        let ativo = true;
        setVersoes([]);
        if (selecionado) {
            void consultarModpacksDome<VersaoModpackDome[]>('minhas-versoes', selecionado.id)
                .then((lista) => {
                    if (ativo) setVersoes(lista);
                })
                .catch((falha) => {
                    if (ativo) setErro(mensagemErro(falha));
                });
        }
        return () => {
            ativo = false;
        };
    }, [selecionado]);

    useEffect(() => {
        let ativo = true;
        setPreviaConteudo(null);
        setArquivosSelecionados(new Set());
        if (!instanciaId) {
            setCarregandoArquivos(false);
            return;
        }
        setCarregandoArquivos(true);
        void invoke<PreviaPacoteSocial>('obter_previa_pacote_social', { instanceId: instanciaId })
            .then((previa) => {
                if (!ativo) return;
                setPreviaConteudo({ instanciaId, previa });
            })
            .catch((falha) => {
                if (ativo) setErro(mensagemErro(falha));
            })
            .finally(() => {
                if (ativo) setCarregandoArquivos(false);
            });
        return () => {
            ativo = false;
        };
    }, [instanciaId]);

    function selecionar(projeto: ModpackDome | null) {
        setSelecionado(projeto);
        setCriando(true);
        setAba(projeto ? 'informacoes' : 'conteudo');
        setNovaVersao(false);
        setNome(projeto?.title ?? '');
        setDescricao(projeto?.description ?? '');
        setCorpo(projeto?.body ?? '');
        selecaoFotoRef.current++;
        fotoPreparadaRef.current = null;
        setFoto(undefined);
        setNumero(projeto ? '' : '1.0.0');
        setNotas('');
        setCaminho('');
        setInstanciaId(pedido.instanciaId ?? '');
        setErro('');
        setSucesso('');
    }

    async function salvar(evento: FormEvent) {
        evento.preventDefault();
        if (!permitido || ocupado) return;
        setOcupado(true);
        setErro('');
        setSucesso('');
        try {
            validarApresentacao();
            if (!selecionado) validarConteudo();
            if (!selecionado && !caminho && !instanciaId)
                throw new Error('Selecione uma instância ou um arquivo .dome.');
            const fotoPublicacao = fotoPreparadaRef.current ? await fotoPreparadaRef.current : foto;
            const projeto = await consultarModpacksDome<ModpackDome>(
                selecionado ? 'editar' : 'criar',
                selecionado?.id,
                {
                    nome,
                    descricao,
                    corpo,
                    foto: fotoPublicacao,
                },
            );
            setProjetos((lista) => [...lista.filter((item) => item.id !== projeto.id), projeto]);
            setSelecionado(projeto);
            setFoto(undefined);
            if (selecionado) setSucesso('Dados salvos.');
            else {
                setAba('versoes');
                setNovaVersao(true);
                await enviarVersao(projeto);
            }
        } catch (falha) {
            setErro(mensagemErro(falha));
        } finally {
            setOcupado(false);
        }
    }

    async function publicar(evento: FormEvent) {
        evento.preventDefault();
        if (!selecionado || !permitido || ocupado) return;
        setOcupado(true);
        setErro('');
        setSucesso('');
        try {
            validarConteudo();
            await enviarVersao(selecionado);
        } catch (falha) {
            setErro(mensagemErro(falha));
        } finally {
            setOcupado(false);
        }
    }

    async function enviarVersao(projeto: ModpackDome) {
        let temporario: string | undefined;
        try {
            let arquivo = caminho;
            if (instanciaId) {
                const resultado = await invoke<{ caminhoArquivo: string }>('export_launcher_social_sync_package', {
                    instanceId: instanciaId,
                    arquivosConfiguracao: [...arquivosSelecionados],
                    arquivosReferencia: null,
                });
                arquivo = resultado.caminhoArquivo;
                temporario = arquivo;
            }
            await invoke('publicar_versao_modpack_dome', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
                projetoId: projeto.id,
                caminhoArquivo: arquivo,
                dados: { numero, notas, canal },
            });
            const lista = await consultarModpacksDome<VersaoModpackDome[]>('minhas-versoes', projeto.id);
            setVersoes(lista);
            setSelecionado({ ...projeto, publicado: true });
            setProjetos((atuais) =>
                atuais.map((item) => (item.id === projeto.id ? { ...item, publicado: true } : item)),
            );
            setNumero('');
            setNotas('');
            setCaminho('');
            setSucesso('Versão publicada no Explorar.');
            setNovaVersao(false);
            window.dispatchEvent(new Event('dome-modpacks-atualizados'));
        } finally {
            if (temporario)
                await invoke('descartar_pacote_social', { caminhoArquivo: temporario }).catch(() => undefined);
        }
    }

    async function escolherArquivo() {
        const arquivo = await open({
            title: 'Escolher modpack Dome',
            multiple: false,
            filters: [{ name: 'Dome', extensions: ['dome'] }],
        });
        if (typeof arquivo === 'string') {
            setCaminho(arquivo);
            setInstanciaId('');
            selecaoFotoRef.current++;
            fotoPreparadaRef.current = null;
            setFoto(undefined);
        }
    }

    function selecionarInstancia(instancia: Instance) {
        setInstanciaId(instancia.id);
        setCaminho('');
        if (!selecionado) {
            setNome(instancia.name);
            const selecao = ++selecaoFotoRef.current;
            setFoto(instancia.icon);
            fotoPreparadaRef.current = converterIconeModpack(instancia.icon)
                .then((icone) => {
                    if (selecaoFotoRef.current === selecao) setFoto(icone);
                    return icone;
                })
                .catch(() => {
                    if (selecaoFotoRef.current !== selecao) return undefined;
                    setFoto(undefined);
                    setErro('Não foi possível reutilizar o ícone. Escolha uma foto na etapa Informações.');
                    return undefined;
                });
        }
    }

    function escolherFoto(icone: string) {
        selecaoFotoRef.current++;
        fotoPreparadaRef.current = null;
        setFoto(icone);
        setErro('');
    }

    function pedirExclusao(projeto: ModpackDome, versao?: VersaoModpackDome) {
        if (ocupadoRef.current || !permitido) return;
        setErro('');
        setSucesso('');
        setExclusao({ projeto, versao });
    }

    async function excluir() {
        if (!exclusao || ocupadoRef.current || !permitido) return;
        ocupadoRef.current = true;
        setOcupado(true);
        setErro('');
        try {
            const { projeto, versao } = exclusao;
            if (versao) {
                const resposta = await consultarModpacksDome<{ publicado: boolean }>(
                    'excluir-versao', projeto.id, { versaoId: versao.id },
                );
                setVersoes((lista) => lista.filter((item) => item.id !== versao.id));
                setProjetos((lista) => lista.map((item) => item.id === projeto.id
                    ? { ...item, publicado: resposta.publicado } : item));
                setSelecionado((atual) => atual?.id === projeto.id
                    ? { ...atual, publicado: resposta.publicado } : atual);
                setSucesso(`Versão ${versao.version_number} excluída.`);
            } else {
                await consultarModpacksDome('excluir', projeto.id);
                setProjetos((lista) => lista.filter((item) => item.id !== projeto.id));
                if (selecionado?.id === projeto.id) {
                    setSelecionado(null);
                    setCriando(false);
                    setVersoes([]);
                }
                setSucesso(`Projeto ${projeto.title} excluído.`);
            }
            setExclusao(null);
            window.dispatchEvent(new Event('dome-modpacks-atualizados'));
        } catch (falha) {
            setErro(mensagemErro(falha));
        } finally {
            ocupadoRef.current = false;
            setOcupado(false);
        }
    }

    async function retirar() {
        if (
            !selecionado ||
            !window.confirm('Retirar este modpack do Explorar? Instalações existentes serão preservadas.')
        )
            return;
        setOcupado(true);
        setErro('');
        try {
            await consultarModpacksDome('retirar', selecionado.id);
            setSelecionado({ ...selecionado, publicado: false });
            setProjetos((lista) =>
                lista.map((item) => (item.id === selecionado.id ? { ...item, publicado: false } : item)),
            );
            setSucesso('Modpack retirado do Explorar.');
            window.dispatchEvent(new Event('dome-modpacks-atualizados'));
        } catch (falha) {
            setErro(mensagemErro(falha));
        } finally {
            setOcupado(false);
        }
    }

    function validarApresentacao() {
        if (nome.trim().length < 3 || nome.trim().length > 64) throw new Error('Use um nome de 3 a 64 caracteres.');
        if (descricao.trim().length < 3 || descricao.trim().length > 512) {
            throw new Error('Preencha um resumo de 3 a 512 caracteres.');
        }
    }

    function validarSelecaoArquivos() {
        if (!instanciaId) return;
        if (carregandoArquivos || previaConteudo?.instanciaId !== instanciaId) {
            throw new Error('Aguarde a leitura dos arquivos da instância.');
        }
        if (
            previaConteudo.previa.arquivos.some((arquivo) => caminhoPublicavel(arquivo.caminho)) &&
            !arquivosSelecionados.size
        ) {
            throw new Error('Selecione os arquivos ou pastas que deseja publicar.');
        }
    }

    function validarConteudo() {
        validarSelecaoArquivos();
        if (!caminho && !instanciaId) throw new Error('Selecione uma instância ou um arquivo .dome.');
        if (!/^[a-zA-Z0-9._+-]{1,32}$/.test(numero.trim())) throw new Error('Informe um número de versão válido.');
    }

    function avancar() {
        try {
            if (aba === 'informacoes') validarApresentacao();
            if (aba === 'conteudo') validarSelecaoArquivos();
            if (aba === 'conteudo' && !caminho && !instanciaId) {
                throw new Error('Selecione uma instância ou um arquivo .dome.');
            }
            if (aba === 'versao') validarConteudo();
            setErro('');
            setAba(etapas[etapas.findIndex((item) => item.id === aba) + 1].id);
        } catch (falha) {
            setErro(mensagemErro(falha));
        }
    }

    const etapas = selecionado
        ? [
              { id: 'informacoes', nome: 'Informações' },
              { id: 'descricao', nome: 'Descrição' },
              { id: 'versoes', nome: 'Versões' },
              { id: 'configuracoes', nome: 'Configurações' },
          ]
        : [
              { id: 'conteudo', nome: 'Conteúdo' },
              { id: 'informacoes', nome: 'Informações' },
              { id: 'descricao', nome: 'Descrição' },
              { id: 'versao', nome: 'Versão' },
              { id: 'revisao', nome: 'Revisão' },
          ];
    const indiceEtapa = etapas.findIndex((item) => item.id === aba);
    return {
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
        setInstanciaId,
        setCaminho,
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
        cancelarExclusao: () => { if (!ocupadoRef.current) setExclusao(null); },
        excluir,
        avancar,
        etapas,
        indiceEtapa,
    };
}
