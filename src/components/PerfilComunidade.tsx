import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as EventoPonteiroReact } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Instance } from "../hooks/useLauncher";
import { CONFIGURACAO_SOCIAL } from "../lib/configuracaoSocial";
import type {
  AmigoSocial,
  AnaliseModpack,
  PerfilSocial,
  RespostaAmigosApi,
  RespostaSessaoRefresh,
  SessaoSocial,
  StatusPresenca,
} from "./social/tiposSocial";
import "./PerfilComunidade.css";

interface PerfilComunidadeProps {
  instances: Instance[];
  minecraftUuid?: string;
  perfilId?: string | null;
  onAbrirInstancia: (instancia: Instance) => void;
  onAbrirBiblioteca: () => void;
  onGerenciarContas: () => void;
  onAbrirPerfil: (perfilId: string) => void;
}

interface CapturaPerfil {
  nome: string;
  instanciaId: string;
  instanciaNome: string;
  criadaEm: string | null;
  dadosUrl: string;
}

interface PaginaCapturasPerfil {
  capturas: CapturaPerfil[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

interface ComentarioPerfil {
  id: string;
  conteudo: string;
  criadoEm: string;
  autorPerfilId: string;
  autorNome: string;
  autorAvatarUrl?: string | null;
}

type SecaoPerfil = "capturas" | "atividade" | "instancias" | "analises";

interface PersonalizacaoPerfil {
  bio: string;
  avatarPersonalizado: string | null;
  bannerPersonalizado: string | null;
  capturasFavoritas: string[];
  instanciasFavoritas: string[];
  ordemSecoes: SecaoPerfil[];
}

const CHAVE_PERSONALIZACAO = "dome:personalizacao-perfil";
const CHAVE_CACHE_PERFIL = "dome:cache-perfil-comunidade";
const DURACAO_CACHE_PERFIL = 5 * 60 * 1000;
const ORDEM_PADRAO: SecaoPerfil[] = ["capturas", "atividade", "instancias", "analises"];
interface CachePerfilComunidade {
  perfil: PerfilSocial;
  comentarios: ComentarioPerfil[];
  salvoEm: number;
}

function carregarCachePerfil(): CachePerfilComunidade | null {
  try {
    const cache = JSON.parse(localStorage.getItem(CHAVE_CACHE_PERFIL) ?? "null") as CachePerfilComunidade | null;
    if (!cache || Date.now() - cache.salvoEm > DURACAO_CACHE_PERFIL) return null;
    return cache;
  } catch {
    return null;
  }
}

function salvarCachePerfil(perfil: PerfilSocial, comentarios: ComentarioPerfil[]): void {
  localStorage.setItem(CHAVE_CACHE_PERFIL, JSON.stringify({ perfil, comentarios, salvoEm: Date.now() }));
}

function identificarCaptura(captura: CapturaPerfil): string {
  return `${captura.instanciaId}:${captura.nome}`;
}

function carregarPersonalizacao(): Partial<PersonalizacaoPerfil> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_PERSONALIZACAO) ?? "{}") as Partial<PersonalizacaoPerfil>;
  } catch {
    return {};
  }
}

function formatarHoras(segundos = 0): string {
  return (segundos / 3600).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  });
}

function formatarData(data: string | null | undefined): string {
  if (!data) return "Data desconhecida";
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return data;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(valor);
}

function obterStatusPresenca(dados: {
  online: boolean;
  status?: StatusPresenca;
  aparecerOffline?: boolean;
}): StatusPresenca {
  if (dados.aparecerOffline || !dados.online) return "offline";
  if (dados.status === "ausente") return "ausente";
  return "online";
}

function rotuloStatusPresenca(status: StatusPresenca): string {
  if (status === "ausente") return "AUSENTE";
  if (status === "offline") return "OFFLINE";
  return "ON-LINE";
}

export default function PerfilComunidade({
  instances,
  minecraftUuid,
  perfilId,
  onAbrirInstancia,
  onAbrirBiblioteca,
  onGerenciarContas,
  onAbrirPerfil,
}: PerfilComunidadeProps) {
  const personalizacaoInicial = useMemo(carregarPersonalizacao, []);
  const cacheInicial = useMemo(carregarCachePerfil, []);
  const assinaturaInstancias = useMemo(
    () => instances.map((instancia) => `${instancia.id}:${instancia.path}`).sort().join("|"),
    [instances],
  );
  const [editando, setEditando] = useState(false);
  const [analises, setAnalises] = useState<AnaliseModpack[]>([]);
  const [bio, setBio] = useState(personalizacaoInicial.bio ?? "Criando mundos e explorando novas aventuras.");
  const [comentarios, setComentarios] = useState<ComentarioPerfil[]>(perfilId ? [] : cacheInicial?.comentarios ?? []);
  const [sessaoSocial, setSessaoSocial] = useState<SessaoSocial | null>(null);
  const [capturas, setCapturas] = useState<CapturaPerfil[]>([]);
  const [capturasCarregadas, setCapturasCarregadas] = useState<CapturaPerfil[]>([]);
  const [paginaCapturas, setPaginaCapturas] = useState(1);
  const [totalPaginasCapturas, setTotalPaginasCapturas] = useState(1);
  const [totalCapturas, setTotalCapturas] = useState(0);
  const [carregandoCapturas, setCarregandoCapturas] = useState(false);
  const [perfil, setPerfil] = useState<PerfilSocial | null>(perfilId ? null : cacheInicial?.perfil ?? null);
  const [amigos, setAmigos] = useState<AmigoSocial[]>([]);
  const [carregandoPerfil, setCarregandoPerfil] = useState(Boolean(perfilId) || !cacheInicial);
  const [erroCarregamentoPerfil, setErroCarregamentoPerfil] = useState(false);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [erroSalvarPerfil, setErroSalvarPerfil] = useState<string | null>(null);
  const [avatarPersonalizado, setAvatarPersonalizado] = useState<string | null>(
    personalizacaoInicial.avatarPersonalizado ?? null,
  );
  const [bannerPersonalizado, setBannerPersonalizado] = useState<string | null>(
    personalizacaoInicial.bannerPersonalizado ?? null,
  );
  const [capturasFavoritas, setCapturasFavoritas] = useState<string[]>(
    personalizacaoInicial.capturasFavoritas ?? [],
  );
  const [instanciasFavoritas, setInstanciasFavoritas] = useState<string[]>(
    personalizacaoInicial.instanciasFavoritas ?? [],
  );
  const [ordemSecoes, setOrdemSecoes] = useState<SecaoPerfil[]>(
    personalizacaoInicial.ordemSecoes?.length === ORDEM_PADRAO.length
      ? personalizacaoInicial.ordemSecoes
      : ORDEM_PADRAO,
  );
  const [itemArrastado, setItemArrastado] = useState<SecaoPerfil | null>(null);
  const [emblemasExibidosIds, setEmblemasExibidosIds] = useState<string[]>([]);
  const [pendentesRecebidas, setPendentesRecebidas] = useState<RespostaAmigosApi["pendentesRecebidas"]>([]);
  const [pendentesEnviadas, setPendentesEnviadas] = useState<RespostaAmigosApi["pendentesEnviadas"]>([]);
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [mensagemAmizade, setMensagemAmizade] = useState<string | null>(null);
  const [mensagemCompartilhar, setMensagemCompartilhar] = useState<string | null>(null);
  const arrastoRef = useRef<{ secao: SecaoPerfil; ponteiroId: number; x: number; y: number; ativo: boolean } | null>(null);
  const ehPerfilProprio = !perfilId || perfilId === sessaoSocial?.perfil.perfilId;
  const [abaAtiva, setAbaAtiva] = useState("visao-geral");
  const atividadesRecentes = useMemo(
    () =>
      [...instances]
        .filter((instancia) => instancia.last_played)
        .sort(
          (a, b) =>
            new Date(b.last_played!).getTime() -
            new Date(a.last_played!).getTime(),
        )
        .slice(0, 3),
    [instances],
  );
  const abrirSecao = (secao: string) => {
    setAbaAtiva(secao);
    document
      .getElementById(secao)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    let ativo = true;
    if (perfilId) {
      setCarregandoPerfil(true);
      setErroCarregamentoPerfil(false);
      setPerfil(null);
      setComentarios([]);
    }
    const carregar = async () => {
      try {
        const conteudo = await invoke<string | null>("carregar_sessao_social_local");
        if (!conteudo) return;
        const sessao = JSON.parse(conteudo) as SessaoSocial;
        setSessaoSocial(sessao);
        if (!cacheInicial && !perfilId) {
          setPerfil(sessao.perfil);
          setCarregandoPerfil(false);
        }
        const [resultadoPerfil, resultadoComentarios, resultadoAmigos] = await Promise.allSettled([
          invoke<PerfilSocial>(
            "get_launcher_social_profile",
            {
              apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
              accessToken: sessao.accessToken,
              perfilId,
            },
          ),
          invoke<ComentarioPerfil[]>("get_launcher_profile_comments", {
            apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
            accessToken: sessao.accessToken,
            perfilId,
          }),
          invoke<RespostaAmigosApi>("get_launcher_friends", {
            apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
            accessToken: sessao.accessToken,
          }),
        ]);
        if (!ativo) return;
        if (resultadoPerfil.status === "rejected" && perfilId) {
          setErroCarregamentoPerfil(true);
          setPerfil(null);
          return;
        }
        const perfilCompleto = resultadoPerfil.status === "fulfilled" ? resultadoPerfil.value : sessao.perfil;
        const comentariosAtualizados = resultadoComentarios.status === "fulfilled"
          ? resultadoComentarios.value
          : cacheInicial?.comentarios ?? [];
        setPerfil(perfilCompleto);
        if (resultadoAmigos?.status === "fulfilled" && resultadoAmigos.value) {
          setAmigos(resultadoAmigos.value.amigos ?? []);
          setPendentesRecebidas(resultadoAmigos.value.pendentesRecebidas ?? []);
          setPendentesEnviadas(resultadoAmigos.value.pendentesEnviadas ?? []);
        }
        setComentarios(comentariosAtualizados);
        if (!perfilId) salvarCachePerfil(perfilCompleto, comentariosAtualizados);
        setBannerPersonalizado(perfilCompleto.bannerPerfilUrl ?? null);
        setCapturasFavoritas(perfilCompleto.capturasFavoritas?.map((captura) => captura.id) ?? []);
        setEmblemasExibidosIds((perfilCompleto.emblemasExibidos ?? perfilCompleto.emblemas ?? []).slice(0, 4).map((emblema) => emblema.emblemaId));
      } finally {
        if (ativo) setCarregandoPerfil(false);
      }
    };
    void carregar();
    return () => { ativo = false; };
  }, [minecraftUuid, perfilId]);
  useEffect(() => {
    if (!sessaoSocial) return;
    let ativo = true;
    void invoke<AnaliseModpack[]>("listar_analises_perfil", {
      apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
      accessToken: sessaoSocial.accessToken,
      perfilId,
    })
      .then((lista) => {
        if (ativo) setAnalises(Array.isArray(lista) ? lista : []);
      })
      .catch(() => {
        if (ativo) setAnalises([]);
      });
    return () => { ativo = false; };
  }, [sessaoSocial, perfilId]);
  useEffect(() => {
    if (editando && ehPerfilProprio) setPaginaCapturas(1);
  }, [editando, ehPerfilProprio]);
  useEffect(() => {
    if (!editando || !ehPerfilProprio) return;
    setCarregandoCapturas(true);
    void invoke<PaginaCapturasPerfil>("listar_capturas_perfil", { pagina: paginaCapturas, tamanhoPagina: 12 })
      .then((resultado) => {
        setCapturas(resultado.capturas);
        setTotalCapturas(resultado.total);
        setTotalPaginasCapturas(resultado.totalPaginas);
        setCapturasCarregadas((atuais) => {
          const mapa = new Map(atuais.map((captura) => [identificarCaptura(captura), captura]));
          resultado.capturas.forEach((captura) => mapa.set(identificarCaptura(captura), captura));
          return [...mapa.values()];
        });
      })
      .catch(() => setCapturas([]))
      .finally(() => setCarregandoCapturas(false));
  }, [assinaturaInstancias, editando, ehPerfilProprio, paginaCapturas]);
  const emblemasDisponiveis = useMemo(
    () => perfil?.emblemas ?? [],
    [perfil?.emblemas],
  );
  const emblemasOrdenadosEdicao = useMemo(() => {
    const ordem = new Map(emblemasExibidosIds.map((id, indice) => [id, indice]));
    return [...emblemasDisponiveis].sort((a, b) => {
      const ordemA = ordem.has(a.emblemaId) ? ordem.get(a.emblemaId)! : Number.MAX_SAFE_INTEGER;
      const ordemB = ordem.has(b.emblemaId) ? ordem.get(b.emblemaId)! : Number.MAX_SAFE_INTEGER;
      return ordemA - ordemB;
    });
  }, [emblemasDisponiveis, emblemasExibidosIds]);
  const emblemasExibidos = useMemo(
    () => (perfil?.emblemasExibidos ?? perfil?.emblemas ?? []).slice(0, 4),
    [perfil?.emblemas, perfil?.emblemasExibidos],
  );
  const emblemaDestaque = useMemo(() => {
    if (editando && emblemasExibidosIds.length > 0) {
      const destaqueId = emblemasExibidosIds[0];
      const encontrado = emblemasDisponiveis.find((emblema) => emblema.emblemaId === destaqueId);
      if (encontrado) return encontrado;
    }
    return emblemasExibidos[0] ?? null;
  }, [editando, emblemasDisponiveis, emblemasExibidos, emblemasExibidosIds]);
  const ehAmigo = useMemo(
    () => (perfil ? amigos.some((amigo) => amigo.friendProfileId === perfil.perfilId) : false),
    [amigos, perfil],
  );
  const solicitacaoEnviadaId = useMemo(
    () => (perfil ? pendentesEnviadas.find((pendente) => pendente.paraPerfilId === perfil.perfilId)?.id ?? null : null),
    [pendentesEnviadas, perfil],
  );
  const solicitacaoRecebidaId = useMemo(
    () => (perfil ? pendentesRecebidas.find((pendente) => pendente.dePerfilId === perfil.perfilId)?.id ?? null : null),
    [pendentesRecebidas, perfil],
  );
  const totalCapturasAba = editando && ehPerfilProprio && totalCapturas > 0
    ? totalCapturas
    : (perfil?.capturasFavoritas?.length ?? capturasFavoritas.length);
  const capturasExibidas = useMemo(() => {
    if (!editando && perfil?.capturasFavoritas) {
      return perfil.capturasFavoritas.map((captura) => ({
        nome: captura.nome,
        instanciaId: captura.id,
        instanciaNome: captura.instanciaNome,
        criadaEm: captura.criadaEm ?? null,
        dadosUrl: captura.imagemUrl,
      }));
    }
    if (capturasFavoritas.length === 0) return [];
    return capturasFavoritas
      .map((id) => capturasCarregadas.find((captura) => identificarCaptura(captura) === id))
      .filter((captura): captura is CapturaPerfil => Boolean(captura))
      .slice(0, 3);
  }, [capturasCarregadas, capturasFavoritas, editando, perfil?.capturasFavoritas]);
  const instanciasExibidas = useMemo(() => {
    if (instanciasFavoritas.length === 0) return instances.slice(0, 3);
    return instanciasFavoritas
      .map((id) => instances.find((instancia) => instancia.id === id))
      .filter((instancia): instancia is Instance => Boolean(instancia))
      .slice(0, 3);
  }, [instances, instanciasFavoritas]);
  const nomePerfil =
    perfil?.nomeSocial ||
    perfil?.discordGlobalName ||
    perfil?.discordUsername ||
    "Seu perfil";
  const handlePerfil = perfil?.handle || "";
  const uuidAvatar = perfil?.contaMinecraftPrincipalUuid || minecraftUuid;
  const urlAvatar = avatarPersonalizado || (uuidAvatar
    ? `https://mc-heads.net/head/${uuidAvatar}/128`
    : null);
  const perfilAutenticado = sessaoSocial?.perfil;
  const statusPresenca = perfil ? obterStatusPresenca(perfil) : "offline";
  const uuidAvatarAutor = perfilAutenticado?.contaMinecraftPrincipalUuid || minecraftUuid;
  const urlAvatarAutor = uuidAvatarAutor
    ? `https://mc-heads.net/head/${uuidAvatarAutor}/128`
    : perfilAutenticado?.discordAvatar
      ? `https://cdn.discordapp.com/avatars/${perfilAutenticado.discordId}/${perfilAutenticado.discordAvatar}.png?size=128`
      : null;
  const lerImagem = (
    arquivo: File | undefined,
    concluir: (dados: string) => void,
  ) => {
    if (!arquivo || !arquivo.type.startsWith("image/")) return;
    const leitor = new FileReader();
    leitor.onload = () => concluir(String(leitor.result));
    leitor.readAsDataURL(arquivo);
  };
  const publicarComentario = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const texto = String(dados.get("comentario") ?? "").trim();
    if (!texto || !sessaoSocial) return;
    const comentarioRecebido = await invoke<ComentarioPerfil>("post_launcher_profile_comment", {
      apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
      accessToken: sessaoSocial.accessToken,
      conteudo: texto,
      perfilId,
    });
    const comentario = comentarioRecebido.autorPerfilId === perfilAutenticado?.perfilId
      ? {
          ...comentarioRecebido,
          autorNome: perfilAutenticado.nomeSocial
            || perfilAutenticado.discordGlobalName
            || perfilAutenticado.discordUsername,
          autorAvatarUrl: comentarioRecebido.autorAvatarUrl || urlAvatarAutor,
        }
      : comentarioRecebido;
    setComentarios((atuais) => {
      const atualizados = [comentario, ...atuais];
      if (perfil) salvarCachePerfil(perfil, atualizados);
      return atualizados;
    });
    evento.currentTarget.reset();
  };
  const excluirComentario = async (comentarioId: string) => {
    if (!sessaoSocial) return;
    await invoke("delete_launcher_profile_comment", {
      apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
      accessToken: sessaoSocial.accessToken,
      comentarioId,
    });
    setComentarios((atuais) => {
      const atualizados = atuais.filter((comentario) => comentario.id !== comentarioId);
      if (perfil) salvarCachePerfil(perfil, atualizados);
      return atualizados;
    });
  };
  const excluirAnalise = async (analiseId: string) => {
    if (!sessaoSocial || !confirm("Excluir esta análise?")) return;
    try {
      await invoke("excluir_analise_modpack", {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: sessaoSocial.accessToken,
        analiseId,
      });
      setAnalises((atuais) => atuais.filter((analise) => analise.id !== analiseId));
    } catch {
      alert("Não foi possível excluir a análise.");
    }
  };
  const alternarEmblemaExibido = (emblemaId: string) => {
    setEmblemasExibidosIds((atuais) => {
      if (atuais.includes(emblemaId)) return atuais.filter((id) => id !== emblemaId);
      if (atuais.length >= 4) return atuais;
      return [...atuais, emblemaId];
    });
  };
  const tornarEmblemaDestaque = (emblemaId: string) => {
    setEmblemasExibidosIds((atuais) => {
      if (!atuais.includes(emblemaId)) return atuais;
      return [emblemaId, ...atuais.filter((id) => id !== emblemaId)];
    });
  };
  const moverEmblemaExibido = (emblemaId: string, direcao: -1 | 1) => {
    setEmblemasExibidosIds((atuais) => {
      const indice = atuais.indexOf(emblemaId);
      if (indice < 0) return atuais;
      const destino = indice + direcao;
      if (destino < 0 || destino >= atuais.length) return atuais;
      const novaOrdem = [...atuais];
      [novaOrdem[indice], novaOrdem[destino]] = [novaOrdem[destino]!, novaOrdem[indice]!];
      return novaOrdem;
    });
  };
  const compartilharPerfil = async () => {
    if (!perfil) return;
    const identificador = handlePerfil || perfil.perfilId;
    const texto = `Dome • ${nomePerfil} (@${identificador})`;
    setMensagemCompartilhar(null);
    try {
      if (navigator.share) {
        await navigator.share({ title: texto, text: texto });
        return;
      }
      await navigator.clipboard.writeText(texto);
      setMensagemCompartilhar("Link copiado!");
    } catch {
      try {
        await navigator.clipboard.writeText(texto);
        setMensagemCompartilhar("Link copiado!");
      } catch {
        setMensagemCompartilhar("Não foi possível compartilhar.");
      }
    }
  };
  const enviarSolicitacaoAmizade = async () => {
    if (!sessaoSocial || !perfil || !handlePerfil || enviandoSolicitacao) return;
    setEnviandoSolicitacao(true);
    setMensagemAmizade(null);
    try {
      const resposta = await invoke<{ id: string; destinatarioPerfilId: string }>(
        "send_launcher_friend_request_by_handle",
        {
          apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
          accessToken: sessaoSocial.accessToken,
          payload: { handle: handlePerfil },
        },
      );
      setPendentesEnviadas((atuais) => [
        {
          id: resposta.id,
          paraPerfilId: resposta.destinatarioPerfilId || perfil.perfilId,
          paraHandle: handlePerfil,
          paraNome: nomePerfil,
          criadoEm: new Date().toISOString(),
        },
        ...atuais,
      ]);
      setMensagemAmizade("Solicitação enviada.");
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      setMensagemAmizade(mensagem || "Não foi possível enviar solicitação.");
    } finally {
      setEnviandoSolicitacao(false);
    }
  };
  const aceitarSolicitacaoRecebida = async () => {
    if (!sessaoSocial || !solicitacaoRecebidaId) return;
    setEnviandoSolicitacao(true);
    setMensagemAmizade(null);
    try {
      await invoke("respond_launcher_friend_request", {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: sessaoSocial.accessToken,
        requestId: solicitacaoRecebidaId,
        acao: "accept",
      });
      const dados = await invoke<RespostaAmigosApi>("get_launcher_friends", {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: sessaoSocial.accessToken,
      });
      setAmigos(dados.amigos ?? []);
      setPendentesRecebidas(dados.pendentesRecebidas ?? []);
      setPendentesEnviadas(dados.pendentesEnviadas ?? []);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      setMensagemAmizade(mensagem || "Não foi possível aceitar.");
    } finally {
      setEnviandoSolicitacao(false);
    }
  };
  const mandarMensagemParaAmigo = () => {
    if (!perfil) return;
    window.dispatchEvent(
      new CustomEvent("dome:social-abrir-chat", { detail: { friendProfileId: perfil.perfilId } }),
    );
  };
  const ordemDaSecao = (secao: SecaoPerfil) => ordemSecoes.indexOf(secao);
  const moverSecao = (origem: SecaoPerfil, destino: SecaoPerfil) => {
    if (origem === destino) return;
    setOrdemSecoes((ordemAtual) => {
      const indiceDestino = ordemAtual.indexOf(destino);
      const novaOrdem = ordemAtual.filter((secao) => secao !== origem);
      novaOrdem.splice(indiceDestino, 0, origem);
      return novaOrdem;
    });
  };
  const iniciarArrastoSecao = (evento: EventoPonteiroReact<HTMLElement>, secao: SecaoPerfil) => {
    if (!editando || evento.button !== 0 || !evento.isPrimary) return;
    arrastoRef.current = { secao, ponteiroId: evento.pointerId, x: evento.clientX, y: evento.clientY, ativo: false };
    const mover = (movimento: PointerEvent) => {
      const arrasto = arrastoRef.current;
      if (!arrasto || movimento.pointerId !== arrasto.ponteiroId) return;
      if (!arrasto.ativo && Math.hypot(movimento.clientX - arrasto.x, movimento.clientY - arrasto.y) < 5) return;
      arrasto.ativo = true;
      setItemArrastado(arrasto.secao);
      const alvo = document.elementFromPoint(movimento.clientX, movimento.clientY)
        ?.closest<HTMLElement>("[data-secao-perfil]")?.dataset.secaoPerfil as SecaoPerfil | undefined;
      if (alvo) moverSecao(arrasto.secao, alvo);
      movimento.preventDefault();
    };
    const finalizar = (fim: PointerEvent) => {
      if (fim.pointerId !== arrastoRef.current?.ponteiroId) return;
      arrastoRef.current = null;
      setItemArrastado(null);
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", finalizar, true);
      window.removeEventListener("pointercancel", finalizar, true);
    };
    window.addEventListener("pointermove", mover, { passive: false });
    window.addEventListener("pointerup", finalizar, true);
    window.addEventListener("pointercancel", finalizar, true);
    evento.preventDefault();
  };
  const salvarPersonalizacao = async () => {
    if (!sessaoSocial || salvandoPerfil) {
      setErroSalvarPerfil("A sessão social ainda não está pronta. Tente novamente em instantes.");
      return;
    }
    setSalvandoPerfil(true);
    setErroSalvarPerfil(null);
    try {
      let sessaoAtual = sessaoSocial;
      if (new Date(sessaoAtual.expiraEm).getTime() <= Date.now() + 20_000) {
        const renovada = await invoke<RespostaSessaoRefresh>("refresh_launcher_social_session", {
          apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
          refreshToken: sessaoAtual.refreshToken,
        });
        sessaoAtual = { ...sessaoAtual, accessToken: renovada.accessToken, expiraEm: renovada.expiraEm };
        setSessaoSocial(sessaoAtual);
        await invoke("salvar_sessao_social_local", { sessao: JSON.stringify(sessaoAtual) });
      }
      const capturasSelecionadas = capturasFavoritas
        .map((id) => capturasCarregadas.find((captura) => identificarCaptura(captura) === id))
        .filter((captura): captura is CapturaPerfil => Boolean(captura));
      const perfilAtualizado = await invoke<PerfilSocial>("save_launcher_profile_presentation", {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: sessaoAtual.accessToken,
        bannerDadosUrl: bannerPersonalizado,
        capturas: capturasSelecionadas.map((captura) => ({ ...captura, id: identificarCaptura(captura) })),
        emblemasExibidosIds,
      });
      setPerfil(perfilAtualizado);
      setBannerPersonalizado(perfilAtualizado.bannerPerfilUrl ?? null);
      setEmblemasExibidosIds((perfilAtualizado.emblemasExibidos ?? perfilAtualizado.emblemas ?? []).slice(0, 4).map((emblema) => emblema.emblemaId));
      window.dispatchEvent(
        new CustomEvent("dome:social-perfil-atualizado", { detail: { perfil: perfilAtualizado } }),
      );
      localStorage.setItem(CHAVE_PERSONALIZACAO, JSON.stringify({
        bio,
        avatarPersonalizado,
        bannerPersonalizado: perfilAtualizado.bannerPerfilUrl ?? null,
        capturasFavoritas: perfilAtualizado.capturasFavoritas?.map((captura) => captura.id) ?? [],
        instanciasFavoritas,
        ordemSecoes,
      } satisfies PersonalizacaoPerfil));
      salvarCachePerfil(perfilAtualizado, comentarios);
      setEditando(false);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      setErroSalvarPerfil(mensagem || "Não foi possível salvar o perfil.");
    } finally {
      setSalvandoPerfil(false);
    }
  };
  const cancelarEdicao = () => {
    const salva = carregarPersonalizacao();
    setBio(salva.bio ?? "Criando mundos e explorando novas aventuras.");
    setAvatarPersonalizado(salva.avatarPersonalizado ?? null);
    setBannerPersonalizado(perfil?.bannerPerfilUrl ?? null);
    setCapturasFavoritas(perfil?.capturasFavoritas?.map((captura) => captura.id) ?? []);
    setEmblemasExibidosIds((perfil?.emblemasExibidos ?? perfil?.emblemas ?? []).slice(0, 4).map((emblema) => emblema.emblemaId));
    setInstanciasFavoritas(salva.instanciasFavoritas ?? []);
    setOrdemSecoes(
      salva.ordemSecoes?.length === ORDEM_PADRAO.length ? salva.ordemSecoes : ORDEM_PADRAO,
    );
    setEditando(false);
  };
  if (carregandoPerfil) return <SkeletonPerfil />;
  if (!perfil) {
    return (
      <div className="perfil-comunidade perfil-sem-sessao">
        <strong>{erroCarregamentoPerfil ? "Não foi possível carregar este perfil" : "Conecte sua conta para abrir o perfil"}</strong>
        {!erroCarregamentoPerfil && <button className="botao primario" type="button" onClick={onGerenciarContas}>Conectar conta</button>}
      </div>
    );
  }
  return (
    <div className={`perfil-comunidade ${ehPerfilProprio ? "perfil-proprio" : "perfil-alheio"} ${!ehPerfilProprio && !perfil.capturasFavoritas?.length ? "sem-capturas-publicas" : ""}`}>
      <main id="topo">
            <section className="hero" aria-labelledby="nome-perfil">
              <div className="banner" id="bannerPerfil">
                <svg
                  className="mundo-isometrico"
                  viewBox="0 0 1600 450"
                  preserveAspectRatio="xMidYMid slice"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="ceu" x1={0} y1={0} x2={0} y2={1}>
                      <stop offset={0} stopColor="var(--cor-acento-900)" />
                      <stop offset="0.52" stopColor="var(--cor-acento-700)" />
                      <stop offset={1} stopColor="#130d0c" />
                    </linearGradient>
                    <radialGradient id="brilho" cx="74%" cy="28%" r="45%">
                      <stop offset={0} stopColor="var(--cor-acento-300)" stopOpacity=".9" />
                      <stop
                        offset=".35"
                        stopColor="var(--cor-acento-500)"
                        stopOpacity=".28"
                      />
                      <stop offset={1} stopColor="#150a09" stopOpacity={0} />
                    </radialGradient>
                    <linearGradient id="grama" x1={0} y1={0} x2={1} y2={1}>
                      <stop stopColor="#638b46" />
                      <stop offset={1} stopColor="#293c28" />
                    </linearGradient>
                    <linearGradient id="pedra" x1={0} y1={0} x2={0} y2={1}>
                      <stop stopColor="#776b64" />
                      <stop offset={1} stopColor="#322b2a" />
                    </linearGradient>
                    <filter
                      id="sombra"
                      x="-30%"
                      y="-30%"
                      width="160%"
                      height="170%"
                    >
                      <feDropShadow
                        dx={0}
                        dy={18}
                        stdDeviation={14}
                        floodColor="#000"
                        floodOpacity=".6"
                      />
                    </filter>
                  </defs>
                  <rect width={1600} height={450} fill="url(#ceu)" />
                  <rect width={1600} height={450} fill="url(#brilho)" />
                  <circle
                    cx={1190}
                    cy={107}
                    r={45}
                    fill="#ffb06a"
                    opacity=".92"
                  />
                  <g opacity=".18" fill="#ffd0a7">
                    <rect x={90} y={90} width={8} height={8} />
                    <rect x={230} y={53} width={5} height={5} />
                    <rect x={430} y={120} width={7} height={7} />
                    <rect x={1390} y={74} width={6} height={6} />
                  </g>
                  <g filter="url(#sombra)" transform="translate(510 44)">
                    <path
                      d="M0 225 365 38l451 205-369 193z"
                      fill="#12100f"
                      opacity=".7"
                    />
                    <path
                      d="m20 185 315-160 375 173-316 166z"
                      fill="url(#grama)"
                    />
                    <path d="m20 185 374 179v64L20 248z" fill="#2c3226" />
                    <path d="m394 364 316-166v63L394 428z" fill="#201d19" />
                    <g>
                      <path d="m102 179 94-48 110 51-94 49z" fill="#759c4c" />
                      <path d="m102 179 110 52v66l-110-53z" fill="#3a4d2d" />
                      <path d="m212 231 94-49v65l-94 50z" fill="#292e26" />
                      <path d="m418 144 93-48 110 51-94 49z" fill="#81766b" />
                      <path d="m418 144 109 52v102l-109-53z" fill="#443d38" />
                      <path d="m527 196 94-49v102l-94 49z" fill="#2c2927" />
                      <path d="m455 93 29-15 35 16-30 16z" fill="#934135" />
                      <path d="m455 93 34 17v61l-34-17z" fill="#57241f" />
                      <path d="m489 110 30-16v61l-30 16z" fill="#391a17" />
                      <path d="m276 120 47-24 55 25-47 25z" fill="#4c7e38" />
                      <path d="m276 120 55 26v50l-55-26z" fill="#2d4b27" />
                      <path d="m331 146 47-25v50l-47 25z" fill="#1d3220" />
                    </g>
                    <path
                      d="m312 293 96-51 66 31-97 51z"
                      fill="#368599"
                      opacity=".85"
                    />
                    <path d="m224 315 94-49 58 28-93 49z" fill="#7e674c" />
                    <g transform="translate(556 223)">
                      <path d="m0 34 38-20 45 21-38 20z" fill="#7a4226" />
                      <path d="m0 34 45 21v45L0 79z" fill="#52291c" />
                      <path d="m45 55 38-20v45l-38 20z" fill="#301c18" />
                      <path d="m17 28 25-42 25 43-25 13z" fill="#ffbc42" />
                      <path d="m28 28 14-26 14 27-14 7z" fill="#ff462d" />
                    </g>
                  </g>
                  <path
                    d="M0 358c220-63 400-42 594 19 207 65 395 32 554-19 172-55 315-47 452-9v101H0z"
                    fill="#090909"
                    opacity=".6"
                  />
                </svg>
                <div
                  className={`banner-customizado ${bannerPersonalizado ? "visivel" : ""}`}
                  id="bannerCustomizado"
                  style={
                    bannerPersonalizado
                      ? { backgroundImage: `url("${bannerPersonalizado}")` }
                      : undefined
                  }
                />
                <div className="banner-sombra" />
                {editando && (
                  <div className="acoes-editar-banner">
                    <label className="editar-imagem editar-banner" htmlFor="arquivoBanner">Trocar banner</label>
                    {bannerPersonalizado && <button type="button" onClick={() => setBannerPersonalizado(null)}>Remover</button>}
                  </div>
                )}
                <input
                  id="arquivoBanner"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(evento) => lerImagem(evento.target.files?.[0], setBannerPersonalizado)}
                />
              </div>
              <div className="perfil-cabecalho">
                <div
                  className={`avatar-moldura preset-rubi status-${statusPresenca}`}
                  id="avatarMoldura"
                >
                  {avatarPersonalizado ? (
                    <img
                      id="avatarCustomizado"
                      src={avatarPersonalizado}
                      alt={`Avatar de ${nomePerfil}`}
                      style={{ display: "block" }}
                    />
                  ) : urlAvatar ? (
                    <img
                      id="avatarCustomizado"
                      src={urlAvatar}
                      alt={`Avatar de ${nomePerfil}`}
                      style={{ display: "block" }}
                    />
                  ) : (
                    <svg
                      id="avatarPadrao"
                      className="avatar-pixel"
                      viewBox="0 0 128 128"
                      aria-label="Avatar padrão do perfil"
                    >
                      <rect width={128} height={128} fill="#161616" />
                      <rect
                        x={24}
                        y={16}
                        width={80}
                        height={24}
                        fill="#24170f"
                      />
                      <rect
                        x={16}
                        y={32}
                        width={96}
                        height={56}
                        fill="#c98f67"
                      />
                      <rect
                        x={24}
                        y={40}
                        width={24}
                        height={24}
                        fill="#31221c"
                      />
                      <rect
                        x={80}
                        y={40}
                        width={24}
                        height={24}
                        fill="#31221c"
                      />
                      <rect
                        x={32}
                        y={48}
                        width={16}
                        height={16}
                        fill="#5bdfd4"
                      />
                      <rect
                        x={80}
                        y={48}
                        width={16}
                        height={16}
                        fill="#5bdfd4"
                      />
                      <rect
                        x={56}
                        y={64}
                        width={16}
                        height={16}
                        fill="#a96d4b"
                      />
                      <rect
                        x={40}
                        y={80}
                        width={48}
                        height={8}
                        fill="#563329"
                      />
                      <rect
                        x={24}
                        y={88}
                        width={80}
                        height={40}
                        fill="#7d1717"
                      />
                      <rect
                        x={48}
                        y={88}
                        width={32}
                        height={40}
                        fill="#d7d7d7"
                      />
                      <rect
                        x={56}
                        y={96}
                        width={16}
                        height={32}
                        fill="#282828"
                      />
                    </svg>
                  )}
                  <span
                    className={`avatar-status status-${statusPresenca}`}
                    title={rotuloStatusPresenca(statusPresenca)}
                  />
                  {editando && (
                    <label className="editar-imagem editar-avatar" htmlFor="arquivoAvatar">
                      Trocar
                    </label>
                  )}
                  <input
                    id="arquivoAvatar"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(evento) => lerImagem(evento.target.files?.[0], setAvatarPersonalizado)}
                  />
                </div>
                <div className="identidade">
                  <div className="nome-linha">
                    <h1 id="nome-perfil">{nomePerfil}</h1>
                    {emblemaDestaque && (
                      <img
                        className="emblema-destaque-nome"
                        src={emblemaDestaque.imagemUrl}
                        alt={`Destaque: ${emblemaDestaque.nome}`}
                        title={`${emblemaDestaque.nome} — ${emblemaDestaque.descricao}`}
                      />
                    )}
                    <span className={`estado-presenca status-${statusPresenca}`}>
                      {rotuloStatusPresenca(statusPresenca)}
                    </span>
                  </div>
                  {handlePerfil && <p className="arroba">@{handlePerfil}</p>}
                  {editando ? (
                    <div className="bio-edicao">
                      <textarea
                        id="campoBio"
                        maxLength={140}
                        rows={3}
                        value={bio}
                        onChange={(evento) => setBio(evento.target.value)}
                      />
                      <span>{bio.length} / 140</span>
                    </div>
                  ) : ehPerfilProprio ? (
                    <p className="bio" id="bioPerfil">{bio}</p>
                  ) : null}
                </div>
                <div className="resumo-conta">
                  {editando && ehPerfilProprio ? (
                    <div className="seletor-emblemas-perfil inline-cabecalho" aria-label="Escolher emblemas exibidos">
                      {emblemasOrdenadosEdicao.map((emblema) => {
                        const indice = emblemasExibidosIds.indexOf(emblema.emblemaId);
                        const selecionado = indice >= 0;
                        return (
                          <div key={emblema.emblemaId} className={`emblema-opcao ${selecionado ? "selecionado" : ""}`}>
                            <button
                              type="button"
                              className="emblema-botao"
                              title={indice === 0 ? "Emblema em destaque" : emblema.nome}
                              onClick={() => alternarEmblemaExibido(emblema.emblemaId)}
                            >
                              <img src={emblema.imagemUrl} alt={emblema.nome} />
                              {selecionado && <b>{indice + 1}</b>}
                            </button>
                            {selecionado && (
                              <div className="emblema-ordem">
                                <button type="button" title="Mover para esquerda" disabled={indice <= 0} onClick={() => moverEmblemaExibido(emblema.emblemaId, -1)}>‹</button>
                                {indice !== 0 ? (
                                  <button type="button" title="Tornar destaque" onClick={() => tornarEmblemaDestaque(emblema.emblemaId)}>★</button>
                                ) : (
                                  <span className="destaque-marca" title="Destaque atual">★</span>
                                )}
                                <button type="button" title="Mover para direita" disabled={indice >= emblemasExibidosIds.length - 1} onClick={() => moverEmblemaExibido(emblema.emblemaId, 1)}>›</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {emblemasDisponiveis.length === 0 && <span>Nenhum emblema conquistado.</span>}
                    </div>
                  ) : (
                    <div className="emblemas-resumo" aria-label="Emblemas em destaque">
                      {emblemasExibidos.map((emblema, indice) => (
                        <button
                          key={emblema.emblemaId}
                          type="button"
                          className={indice === 0 ? "emblema-primeiro" : undefined}
                          aria-label={`${emblema.nome}: ${emblema.descricao}. Conquistado em ${formatarData(emblema.concedidoEm)}${indice === 0 ? " (destaque)" : ""}`}
                        >
                          <img src={emblema.imagemUrl} alt={emblema.nome} />
                          <span className="tooltip-emblema">
                            <strong>{emblema.nome}{indice === 0 ? " ★" : ""}</strong>
                            <span>{emblema.descricao}</span>
                            <small>Conquistado em {formatarData(emblema.concedidoEm)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="cabecalho-acoes abaixo-emblemas">
                    {!editando && ehPerfilProprio && (
                      <button className="botao primario" id="editarPerfil" type="button" onClick={() => setEditando(true)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.5 7l3.5 3.5" /></svg>
                        Editar perfil
                      </button>
                    )}
                    {!editando && !ehPerfilProprio && (
                      <>
                        {ehAmigo ? (
                          <button className="botao primario" type="button" onClick={mandarMensagemParaAmigo}>
                            Mandar mensagem
                          </button>
                        ) : solicitacaoEnviadaId ? (
                          <button className="botao secundario" type="button" disabled title="Aguardando resposta do jogador">
                            Solicitação enviada
                          </button>
                        ) : solicitacaoRecebidaId ? (
                          <button className="botao primario" type="button" disabled={enviandoSolicitacao} onClick={() => void aceitarSolicitacaoRecebida()}>
                            {enviandoSolicitacao ? "Aceitando..." : "Aceitar pedido"}
                          </button>
                        ) : (
                          <button className="botao primario" type="button" disabled={enviandoSolicitacao} onClick={() => void enviarSolicitacaoAmizade()}>
                            {enviandoSolicitacao ? "Enviando..." : "Adicionar amigo"}
                          </button>
                        )}
                      </>
                    )}
                    <button className="botao secundario" type="button" onClick={() => void compartilharPerfil()}>Compartilhar</button>
                    {ehPerfilProprio && <button className="botao icone" type="button" aria-label="Mais opções" onClick={onGerenciarContas}>•••</button>}
                    {(mensagemAmizade || mensagemCompartilhar) && (
                      <span className="feedback-acao" role="status">{mensagemAmizade ?? mensagemCompartilhar}</span>
                    )}
                  </div>
                </div>
              </div>
            </section>
            <nav className="abas-perfil" aria-label="Navegação do perfil">
              <button
                className={`aba ${abaAtiva === "visao-geral" ? "ativa" : ""}`}
                data-alvo="visao-geral"
                type="button"
                onClick={() => abrirSecao("visao-geral")}
              >
                VISÃO GERAL
              </button>
              <button
                className={`aba ${abaAtiva === "atividade" ? "ativa" : ""}`}
                data-alvo="atividade"
                type="button"
                onClick={() => abrirSecao("atividade")}
              >
                ATIVIDADE
              </button>
              <button
                className={`aba ${abaAtiva === "instancias" ? "ativa" : ""}`}
                data-alvo="instancias"
                type="button"
                onClick={() => abrirSecao("instancias")}
              >
                INSTÂNCIAS <span>{instances.length}</span>
              </button>
              <button
                className={`aba ${abaAtiva === "capturas" ? "ativa" : ""}`}
                data-alvo="capturas"
                type="button"
                onClick={() => abrirSecao("capturas")}
              >
                CAPTURAS <span>{totalCapturasAba}</span>
              </button>
              <button
                className={`aba ${abaAtiva === "analises" ? "ativa" : ""}`}
                data-alvo="analises"
                type="button"
                onClick={() => abrirSecao("analises")}
              >
                ANÁLISES <span>{analises.length}</span>
              </button>
            </nav>
            {editando && (
              <div className="barra-edicao-inline" role="status">
                <div>
                  <strong>Editando perfil</strong>
                  <span>{erroSalvarPerfil ?? "Clique nos emblemas acima para escolher até 4. O primeiro é o destaque."}</span>
                </div>
                <button className="botao secundario" type="button" disabled={salvandoPerfil} onClick={cancelarEdicao}>
                  Cancelar
                </button>
                <button className="botao primario" type="button" disabled={salvandoPerfil} onClick={() => void salvarPersonalizacao()}>
                  {salvandoPerfil ? "Salvando..." : "Salvar alterações"}
                </button>
              </div>
            )}
            <div className="layout-perfil" id="visao-geral">
              <div className="coluna-principal">
                <section
                  className={`secao capturas-destaque ${editando ? "secao-editavel" : ""} ${itemArrastado === "capturas" ? "arrastando" : ""}`}
                  id="capturas"
                  data-secao-perfil="capturas"
                  style={{ order: ordemDaSecao("capturas") }}
                >
                  <div className="secao-titulo">
                    <div>
                      <span className="sobretitulo">GALERIA PESSOAL</span>
                      <h2>Capturas favoritas</h2>
                    </div>
                    {editando && <button type="button" className="alca-secao" title="Arrastar seção" onPointerDown={(evento) => iniciarArrastoSecao(evento, "capturas")}>⠿</button>}
                    <button
                      className="link-botao"
                      type="button"
                      onClick={onAbrirBiblioteca}
                    >
                      Ver todas <span>→</span>
                    </button>
                  </div>
                  {editando && (
                    <div className="seletor-capturas inline">
                      <p className="dica-capturas">Escolha até 3 favoritas. A lista carrega em páginas de 12 para não travar.</p>
                      {carregandoCapturas && (
                        <div className="loading-capturas" role="status" aria-live="polite">
                          <span className="spinner" aria-hidden="true" />
                          <div>
                            <strong>Carregando capturas...</strong>
                            <small>Página {paginaCapturas}{totalPaginasCapturas > 1 ? ` de ${totalPaginasCapturas}` : ""}</small>
                          </div>
                          <div className="skeleton-miniaturas" aria-hidden="true">
                            <i /><i /><i /><i /><i /><i />
                          </div>
                        </div>
                      )}
                      {!carregandoCapturas && capturas.map((captura) => {
                        const id = identificarCaptura(captura);
                        const selecionada = capturasFavoritas.includes(id);
                        return (
                          <button
                            className={`opcao-captura ${selecionada ? "selecionada" : ""}`}
                            key={id}
                            type="button"
                            onClick={() => setCapturasFavoritas((atuais) => {
                              if (selecionada) return atuais.filter((item) => item !== id);
                              if (atuais.length >= 3) return atuais;
                              return [...atuais, id];
                            })}
                          >
                            <img src={captura.dadosUrl} alt={captura.nome} loading="lazy" />
                            <span>{captura.instanciaNome}</span>
                            <strong>{selecionada ? capturasFavoritas.indexOf(id) + 1 : "+"}</strong>
                          </button>
                        );
                      })}
                      {!carregandoCapturas && capturas.length === 0 && <p className="opcoes-vazias">Nenhuma screenshot encontrada.</p>}
                      <div className="paginacao-capturas">
                        <button type="button" disabled={carregandoCapturas || paginaCapturas <= 1} onClick={() => setPaginaCapturas((pagina) => Math.max(1, pagina - 1))}>← Anterior</button>
                        <span>{paginaCapturas} / {totalPaginasCapturas} · {totalCapturas} capturas</span>
                        <button type="button" disabled={carregandoCapturas || paginaCapturas >= totalPaginasCapturas} onClick={() => setPaginaCapturas((pagina) => pagina + 1)}>Próxima →</button>
                      </div>
                    </div>
                  )}
                  {capturasExibidas.length > 0 ? (
                    <div className="mosaico-capturas">
                      {capturasExibidas.map((captura, indice) => (
                        <article
                          className={`captura ${indice === 0 ? "captura-grande" : ""}`}
                          key={`${captura.instanciaId}-${captura.nome}`}
                        >
                          <img
                            className="captura-imagem"
                            src={captura.dadosUrl}
                            alt={`Captura ${captura.nome} de ${captura.instanciaNome}`}
                          />
                          <div className="captura-legenda">
                            <strong>{captura.nome}</strong>
                            <span>
                              {captura.instanciaNome} · {formatarData(captura.criadaEm)}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="estado-vazio-perfil">
                      <strong>Nenhuma captura encontrada</strong>
                      <span>
                        As imagens salvas na pasta screenshots das suas instâncias aparecerão aqui.
                      </span>
                    </div>
                  )}
                </section>
                <section
                  className={`secao ${editando ? "secao-editavel" : ""}`}
                  id="atividade"
                  data-secao-perfil="atividade"
                  style={{ order: ordemDaSecao("atividade") }}
                >
                  <div className="secao-titulo">
                    <div>
                      <span className="sobretitulo">ÚLTIMAS 2 SEMANAS</span>
                      <h2>Atividade recente</h2>
                    </div>
                    {editando && <button type="button" className="alca-secao" title="Arrastar seção" onPointerDown={(evento) => iniciarArrastoSecao(evento, "atividade")}>⠿</button>}
                    <span className="tempo-recente">
                      {formatarHoras(
                        atividadesRecentes.reduce(
                          (total, instancia) =>
                            total + (instancia.tempo_total_jogado_segundos ?? 0),
                          0,
                        ),
                      )} horas registradas
                    </span>
                  </div>
                  <div className="lista-atividade">
                    {atividadesRecentes.map((instancia) => (
                      <article
                        className="atividade-cartao"
                        key={instancia.id}
                        onClick={() => onAbrirInstancia(instancia)}
                      >
                        <div className="atividade-capa">
                          <img
                            src={
                              instancia.icon ||
                              "/perfil-comunidade/assets/icons/grass-block.png"
                            }
                            alt=""
                          />
                        </div>
                        <div className="atividade-conteudo">
                          <div className="atividade-topo">
                            <div>
                              <span className="origem modrinth">
                                {(instancia.loader_type || instancia.mc_type).toUpperCase()}
                              </span>
                              <h3>{instancia.name}</h3>
                            </div>
                          </div>
                          <p>
                            Jogou Minecraft {instancia.version} usando {instancia.loader_type || instancia.mc_type}.
                          </p>
                          <div className="atividade-metricas atividade-metricas-reais">
                            <div>
                              <strong>
                                {formatarHoras(instancia.tempo_total_jogado_segundos)} h
                              </strong>
                              <span>horas jogadas</span>
                            </div>
                            <div>
                              <strong>{formatarData(instancia.last_played)}</strong>
                              <span>última vez</span>
                            </div>
                            <div>
                              <strong>{instancia.version}</strong>
                              <span>versão</span>
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                    {atividadesRecentes.length === 0 && (
                      <div className="estado-vazio-perfil compacto">
                        <strong>Nenhuma atividade recente</strong>
                        <span>As instâncias jogadas aparecerão aqui.</span>
                      </div>
                    )}
                  </div>
                </section>
                <section
                  className={`secao ${editando ? "secao-editavel" : ""}`}
                  id="instancias"
                  data-secao-perfil="instancias"
                  style={{ order: ordemDaSecao("instancias") }}
                >
                  <div className="secao-titulo">
                    <div>
                      <span className="sobretitulo">COLEÇÃO CURADA</span>
                      <h2>Instâncias favoritas</h2>
                    </div>
                    {editando && <button type="button" className="alca-secao" title="Arrastar seção" onPointerDown={(evento) => iniciarArrastoSecao(evento, "instancias")}>⠿</button>}
                    <button
                      className="link-botao"
                      type="button"
                      onClick={onAbrirBiblioteca}
                    >
                      Biblioteca <span>→</span>
                    </button>
                  </div>
                  {editando && (
                    <div className="seletor-instancias inline">
                      {instances.map((instancia) => {
                        const selecionada = instanciasFavoritas.includes(instancia.id);
                        return (
                          <button
                            className={`opcao-instancia ${selecionada ? "selecionada" : ""}`}
                            key={instancia.id}
                            type="button"
                            onClick={() => setInstanciasFavoritas((atuais) => {
                              if (selecionada) return atuais.filter((id) => id !== instancia.id);
                              if (atuais.length >= 3) return atuais;
                              return [...atuais, instancia.id];
                            })}
                          >
                            <img
                              src={instancia.icon || "/perfil-comunidade/assets/icons/grass-block.png"}
                              alt=""
                            />
                            <span>{instancia.name}</span>
                            <strong>{selecionada ? instanciasFavoritas.indexOf(instancia.id) + 1 : "+"}</strong>
                          </button>
                        );
                      })}
                      {instances.length === 0 && <p className="opcoes-vazias">Nenhuma instância instalada.</p>}
                    </div>
                  )}
                  <div className="grade-instancias">
                    {instanciasExibidas.map((instancia) => (
                      <article
                        className="instancia-card"
                        key={instancia.id}
                        onClick={() => {
                          if (instancia.path) onAbrirInstancia(instancia);
                        }}
                      >
                        <span className="faixa-origem modrinth">MC</span>
                        <img
                          src={
                            instancia.icon ||
                            "/perfil-comunidade/assets/icons/grass-block.png"
                          }
                          alt={`Ícone de ${instancia.name}`}
                        />
                        <div>
                          <h3>{instancia.name}</h3>
                          <p>
                            {instancia.loader_type || instancia.mc_type} ·{" "}
                            {instancia.version}
                          </p>
                          <span>
                            {(
                              (instancia.tempo_total_jogado_segundos ?? 0) /
                              3600
                            ).toLocaleString("pt-BR", {
                              maximumFractionDigits: 1,
                            })}{" "}
                            horas
                          </span>
                        </div>
                        <button
                          className="favoritar ativo"
                          type="button"
                          aria-label="Remover dos favoritos"
                        >
                          ♥
                        </button>
                      </article>
                    ))}
                    {instanciasExibidas.length === 0 && (
                      <div className="estado-vazio-perfil compacto">
                        <strong>Nenhuma instância favorita</strong>
                        <span>Escolha até três instâncias ao editar o perfil.</span>
                      </div>
                    )}
                  </div>
                </section>
                <section
                  className={`secao ${editando ? "secao-editavel" : ""}`}
                  id="analises"
                  data-secao-perfil="analises"
                  style={{ order: ordemDaSecao("analises") }}
                >
                  <div className="secao-titulo">
                    <div>
                      <span className="sobretitulo">OPINIÕES PUBLICADAS</span>
                      <h2>Análises</h2>
                    </div>
                    {editando && <button type="button" className="alca-secao" title="Arrastar seção" onPointerDown={(evento) => iniciarArrastoSecao(evento, "analises")}>⠿</button>}
                    <button className="link-botao" type="button" onClick={() => abrirSecao("analises")}>
                      Ver {analises.length} {analises.length === 1 ? "análise" : "análises"} <span>→</span>
                    </button>
                  </div>
                  {analises.length > 0 ? (
                    <div className="lista-analises">
                      {analises.map((analise) => (
                        <article className="analise-card" key={analise.id}>
                          <div className="analise-icone">
                            <img
                              src={analise.projectIcon || "/perfil-comunidade/assets/icons/campfire.png"}
                              alt=""
                            />
                          </div>
                          <div className="analise-corpo">
                            <div>
                              <span className={analise.recomendado ? "recomendado" : "nao-recomendado"}>
                                {analise.recomendado ? "◆ RECOMENDADO" : "◆ NÃO RECOMENDADO"}
                              </span>
                              {typeof analise.horasRegistradas === "number" && (
                                <span className="horas-analise">
                                  {analise.horasRegistradas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h registradas
                                </span>
                              )}
                            </div>
                            <h3>{analise.projectNome}</h3>
                            <p>“{analise.conteudo}”</p>
                            <small>
                              Publicada em {formatarData(analise.criadoEm)} · {analise.totalCurtidas} {analise.totalCurtidas === 1 ? "pessoa achou útil" : "pessoas acharam útil"}
                              {ehPerfilProprio && (
                                <>
                                  {" · "}
                                  <button type="button" className="link-excluir-analise" onClick={() => void excluirAnalise(analise.id)}>
                                    Excluir
                                  </button>
                                </>
                              )}
                            </small>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="estado-vazio-perfil compacto">
                      <strong>Nenhuma análise publicada</strong>
                      <span>
                        {ehPerfilProprio
                          ? "Clique com o botão direito em uma instância de modpack para escrever sua primeira análise."
                          : "Este perfil ainda não publicou análises de modpacks."}
                      </span>
                    </div>
                  )}
                </section>
                <section className="secao comentarios" id="comentarios" style={{ order: 999 }}>
                  <div className="secao-titulo">
                    <div>
                      <span className="sobretitulo">MURAL DO PERFIL</span>
                      <h2>
                        Comentários <span className="contador-titulo">{comentarios.length}</span>
                      </h2>
                    </div>
                  </div>
                  <form
                    className="novo-comentario"
                    id="formComentario"
                    onSubmit={publicarComentario}
                  >
                    {urlAvatarAutor ? (
                      <img className="comentario-avatar imagem" src={urlAvatarAutor} alt="" />
                    ) : (
                      <span className="comentario-avatar eu">
                        {(perfilAutenticado?.nomeSocial || perfilAutenticado?.discordUsername || "V").charAt(0).toUpperCase()}
                      </span>
                    )}
                    <label className="sr-only" htmlFor="campoComentario">
                      Comentar no perfil
                    </label>
                    <input
                      id="campoComentario"
                      name="comentario"
                      maxLength={180}
                      placeholder={`Escreva algo no perfil de ${nomePerfil}...`}
                    />
                    <button className="botao primario" type="submit">
                      Publicar
                    </button>
                  </form>
                  <div className="lista-comentarios" id="listaComentarios">
                    {comentarios.map((comentario) => {
                      const comentarioDoUsuario = comentario.autorPerfilId === perfilAutenticado?.perfilId;
                      const nomeAutor = comentarioDoUsuario
                        ? perfilAutenticado.nomeSocial
                          || perfilAutenticado.discordGlobalName
                          || perfilAutenticado.discordUsername
                        : comentario.autorNome;
                      const avatarAutor = comentario.autorAvatarUrl || (comentarioDoUsuario ? urlAvatarAutor : null);
                      return (
                        <article className="comentario" key={comentario.id}>
                          {avatarAutor ? (
                            <img className="comentario-avatar imagem" src={avatarAutor} alt="" />
                          ) : (
                            <span className="comentario-avatar eu">{nomeAutor.charAt(0).toUpperCase()}</span>
                          )}
                          <div>
                            <div className="comentario-meta">
                              <strong>{nomeAutor}</strong>
                              <span>{formatarData(comentario.criadoEm)}</span>
                            </div>
                            <p>{comentario.conteudo}</p>
                            {(ehPerfilProprio || comentarioDoUsuario) && (
                              <button type="button" onClick={() => void excluirComentario(comentario.id)}>Excluir</button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {comentarios.length === 0 && (
                      <div className="estado-vazio-perfil compacto">Nenhum comentário ainda.</div>
                    )}
                  </div>
                </section>
              </div>
              <aside className="coluna-lateral">
                <section className="painel-lateral amigos-perfil">
                  <div className="painel-titulo">
                    <h2>Amigos</h2>
                    <span>{amigos.length}</span>
                  </div>
                  <div className="lista-amigos-perfil">
                    {amigos.slice(0, 8).map((amigo) => {
                      const estaOnline = obterStatusPresenca(amigo) === "online";
                      const instanciaAtual = amigo.atividadeAtual?.tipo !== "launcher"
                        ? amigo.atividadeAtual?.modpackNome || amigo.atividadeAtual?.instanciaNome
                        : null;

                      return (
                        <button
                          key={amigo.friendProfileId}
                          type="button"
                          className="amigo-perfil-item"
                          onClick={() => onAbrirPerfil(amigo.friendProfileId)}
                          aria-label={`Abrir perfil de ${amigo.nome}`}
                        >
                          {amigo.avatarUrl
                            ? <img src={amigo.avatarUrl} alt="" />
                            : <span>{amigo.nome.charAt(0)}</span>}
                          <div>
                            <strong className="nome-com-emblema">
                              <span>{amigo.nome}</span>
                              {estaOnline && <i className="presenca-amigo-online" title="On-line" />}
                              {amigo.emblemaDestaque && (
                                <img
                                  className="mini-emblema"
                                  src={amigo.emblemaDestaque.imagemUrl}
                                  alt={amigo.emblemaDestaque.nome}
                                  title={amigo.emblemaDestaque.nome}
                                />
                              )}
                            </strong>
                            {instanciaAtual && <small>{instanciaAtual}</small>}
                          </div>
                        </button>
                      );
                    })}
                    {amigos.length === 0 && <p className="opcoes-vazias">Nenhum amigo para mostrar.</p>}
                  </div>
                </section>
                <section className="painel-lateral">
                  <div className="painel-titulo">
                    <div className="painel-titulo-com-pill">
                      <h2>Grupos</h2>
                      <span className="pill-em-breve">em breve</span>
                    </div>
                  </div>
                  {/* Mock de grupos temporariamente oculto
                  <div className="lista-grupos">
                    <article className="grupo-item">
                      <div className="grupo-icone oficina">
                        <img
                          src="/perfil-comunidade/assets/icons/cogwheel.png"
                          alt=""
                        />
                      </div>
                      <div>
                        <strong>Oficina do Bloco</strong>
                        <span>126 membros · 8 on-line</span>
                      </div>
                    </article>
                    <article className="grupo-item">
                      <div className="grupo-icone exploradores">
                        <img
                          src="/perfil-comunidade/assets/icons/grass-block.png"
                          alt=""
                        />
                      </div>
                      <div>
                        <strong>Exploradores BR</strong>
                        <span>48 membros · 3 on-line</span>
                      </div>
                    </article>
                    <article className="grupo-item">
                      <div className="grupo-icone caos">
                        <img
                          src="/perfil-comunidade/assets/icons/ender-dragon.png"
                          alt=""
                        />
                      </div>
                      <div>
                        <strong>Caos Modificado</strong>
                        <span>21 membros · 2 on-line</span>
                      </div>
                    </article>
                  </div>
                  <button className="botao-largura" type="button">
                    Ver todos os grupos
                  </button>
                  */}
                </section>
              </aside>
            </div>
      </main>
      {/* A edição é exclusivamente inline. */}
      <div className="toast" id="toast" role="status" aria-live="polite" />
      {/*
          <div className="modal-cabecalho">
            <div>
              <span className="sobretitulo">PERSONALIZAÇÃO</span>
              <h2>Editar perfil</h2>
            </div>
            <button
              className="fechar-modal"
              value="cancel"
              aria-label="Fechar"
              type="button"
              onClick={() => setEditando(false)}
            >
              ×
            </button>
          </div>
          <div className="modal-conteudo">
            <section className="campo-bloco">
              <div className="campo-cabecalho">
                <label>Imagem de perfil</label>
                <span>Pré-sets ou imagem própria</span>
              </div>
              <div className="presets-avatar">
                <button
                  className="preset selecionado preset-rubi"
                  data-preset="preset-rubi"
                  type="button"
                >
                  <span>L</span>
                  <small>Rubi</small>
                </button>
                <button
                  className="preset preset-vale"
                  data-preset="preset-vale"
                  type="button"
                >
                  <span>L</span>
                  <small>Vale</small>
                </button>
                <button
                  className="preset preset-gelo"
                  data-preset="preset-gelo"
                  type="button"
                >
                  <span>L</span>
                  <small>Gelo</small>
                </button>
                <label className="preset upload-avatar" htmlFor="arquivoAvatar">
                  <span>＋</span>
                  <small>Enviar</small>
                </label>
                <input
                  id="arquivoAvatar"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(evento) =>
                    lerImagem(evento.target.files?.[0], setAvatarPersonalizado)
                  }
                />
              </div>
            </section>
            <section className="campo-bloco">
              <div className="campo-cabecalho">
                <label htmlFor="arquivoBanner">Banner do mundo</label>
                <span>Recomendado: 1600 × 450</span>
              </div>
              <label className="upload-banner" htmlFor="arquivoBanner">
                <span>▧</span>
                <strong>Escolher imagem</strong>
                <small>PNG, JPG ou WEBP</small>
              </label>
              <input
                id="arquivoBanner"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(evento) =>
                  lerImagem(evento.target.files?.[0], setBannerPersonalizado)
                }
              />
            </section>
            <section className="campo-bloco">
              <div className="campo-cabecalho">
                <label>Capturas favoritas</label>
                <span>Escolha até 3 screenshots reais</span>
              </div>
              <div className="seletor-capturas">
                {capturas.map((captura) => {
                  const id = identificarCaptura(captura);
                  const selecionada = capturasFavoritas.includes(id);
                  return (
                    <button
                      className={`opcao-captura ${selecionada ? "selecionada" : ""}`}
                      key={id}
                      type="button"
                      onClick={() => setCapturasFavoritas((atuais) => {
                        if (selecionada) return atuais.filter((item) => item !== id);
                        if (atuais.length >= 3) return atuais;
                        return [...atuais, id];
                      })}
                    >
                      <img src={captura.dadosUrl} alt={captura.nome} />
                      <span>{captura.instanciaNome}</span>
                      <strong>{selecionada ? capturasFavoritas.indexOf(id) + 1 : "+"}</strong>
                    </button>
                  );
                })}
                {capturas.length === 0 && <p className="opcoes-vazias">Nenhuma screenshot encontrada.</p>}
              </div>
            </section>
            <section className="campo-bloco">
              <div className="campo-cabecalho">
                <label>Instâncias favoritas</label>
                <span>Escolha até 3 instâncias</span>
              </div>
              <div className="seletor-instancias">
                {instances.map((instancia) => {
                  const selecionada = instanciasFavoritas.includes(instancia.id);
                  return (
                    <button
                      className={`opcao-instancia ${selecionada ? "selecionada" : ""}`}
                      key={instancia.id}
                      type="button"
                      onClick={() => setInstanciasFavoritas((atuais) => {
                        if (selecionada) return atuais.filter((id) => id !== instancia.id);
                        if (atuais.length >= 3) return atuais;
                        return [...atuais, instancia.id];
                      })}
                    >
                      <img
                        src={instancia.icon || "/perfil-comunidade/assets/icons/grass-block.png"}
                        alt=""
                      />
                      <span>{instancia.name}</span>
                      <strong>{selecionada ? instanciasFavoritas.indexOf(instancia.id) + 1 : "+"}</strong>
                    </button>
                  );
                })}
                {instances.length === 0 && <p className="opcoes-vazias">Nenhuma instância instalada.</p>}
              </div>
            </section>
            <section className="campo-bloco">
              <div className="campo-cabecalho">
                <label>Ordem do perfil</label>
                <span>Arraste as seções; comentários permanecem no final</span>
              </div>
              <div className="ordenador-secoes">
                {ordemSecoes.map((secao) => (
                  <button
                    className={`item-ordenavel ${itemArrastado === secao ? "arrastando" : ""}`}
                    draggable
                    key={secao}
                    type="button"
                    onDragStart={() => setItemArrastado(secao)}
                    onDragEnd={() => setItemArrastado(null)}
                    onDragOver={(evento) => evento.preventDefault()}
                    onDrop={(evento) => soltarSecao(evento, secao)}
                  >
                    <span aria-hidden="true">⠿</span>
                    {ROTULOS_SECOES[secao]}
                  </button>
                ))}
                <div className="item-ordenavel bloqueado"><span>⌑</span> Comentários</div>
              </div>
            </section>
            <section className="campo-bloco">
              <div className="campo-cabecalho">
                <label htmlFor="campoBio">Bio</label>
                <span id="contadorBio">{bio.length} / 140</span>
              </div>
              <textarea
                id="campoBio"
                maxLength={140}
                rows={4}
                value={bio}
                onChange={(evento) => setBio(evento.target.value)}
              />
            </section>
          </div>
          <div className="modal-rodape">
            <button
              className="botao secundario"
              value="cancel"
              type="button"
              onClick={() => setEditando(false)}
            >
              Cancelar
            </button>
            <button
              className="botao primario"
              id="salvarPerfil"
              value="default"
              type="submit"
            >
              Salvar alterações
            </button>
          </div>
        </form>
      </div>
      */}
    </div>
  );
}

function SkeletonPerfil() {
  return (
    <div className="perfil-comunidade skeleton-perfil" aria-label="Carregando perfil" aria-busy="true">
      <div className="skeleton-banner" />
      <div className="skeleton-identidade">
        <span className="skeleton-avatar" />
        <div><i /><i /><i /></div>
      </div>
      <div className="skeleton-abas" />
      <div className="skeleton-conteudo">
        <span /><span /><span />
      </div>
    </div>
  );
}
