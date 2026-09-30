import type { SVGProps } from "react";
import { Icon } from "@iconify/react";
import dadosIcones from "./assets/dadosIconesPixelados.json";

const {
    atividade,
    alerta,
    setaEsquerda,
    setaDireita,
    setasVertical,
    caixa,
    calendario,
    checagem,
    chevronBaixo,
    chevronEsquerda,
    chevronDireita,
    chevronCima,
    relogio,
    cafe,
    copia,
    cpu,
    download,
    linkExterno,
    arquivoTexto,
    pasta,
    pastaMais,
    gamepad,
    globo,
    gripVertical,
    coracao,
    casa,
    imagem,
    grade,
    biblioteca,
    lista,
    carregando,
    login,
    email,
    monitor,
    maisHorizontal,
    maisVertical,
    jornal,
    pacote,
    paleta,
    lapis,
    tocar,
    mais,
    recarregar,
    foguete,
    salvar,
    pesquisar,
    configuracoes,
    escudo,
    brilho,
    estrela,
    terminal,
    lixeira,
    upload,
    pessoa,
    pessoas,
    wifi,
    wifiOff,
    fechar,
    fecharCaixa,
    avatar,
} = dadosIcones;

type PropriedadesIcone = Omit<SVGProps<SVGSVGElement>, "color"> & {
  color?: string;
  size?: number | string;
};

function criarIcone(icone: any) {
  return function ComponenteIcone({
    size = 18,
    className,
    color,
    style,
    ...props
  }: PropriedadesIcone) {
    return (
      <Icon
        icon={icone}
        width={size}
        height={size}
        className={className}
        style={{ color, ...style }}
        {...(props as Record<string, unknown>)}
      />
    );
  };
}

export const Activity = criarIcone(atividade);
export const AlertCircle = criarIcone(alerta);
export const ArrowLeft = criarIcone(setaEsquerda);
export const ArrowRight = criarIcone(setaDireita);
export const ArrowUpDown = criarIcone(setasVertical);
export const Box = criarIcone(caixa);
export const Calendar = criarIcone(calendario);
export const Check = criarIcone(checagem);
export const CheckCircle = criarIcone(checagem);
export const ChevronDown = criarIcone(chevronBaixo);
export const ChevronLeft = criarIcone(chevronEsquerda);
export const ChevronRight = criarIcone(chevronDireita);
export const ChevronUp = criarIcone(chevronCima);
export const Clock = criarIcone(relogio);
export const Coffee = criarIcone(cafe);
export const Copy = criarIcone(copia);
export const Cpu = criarIcone(cpu);
export const Download = criarIcone(download);
export const ExternalLink = criarIcone(linkExterno);
export const FileText = criarIcone(arquivoTexto);
export const FolderOpen = criarIcone(pasta);
export const FolderPlus = criarIcone(pastaMais);
export const Gamepad2 = criarIcone(gamepad);
export const Globe = criarIcone(globo);
export const GripVertical = criarIcone(gripVertical);
export const HardDrive = criarIcone(cpu);
export const Heart = criarIcone(coracao);
export const Home = criarIcone(casa);
export const Image = criarIcone(imagem);
export const LayoutGrid = criarIcone(grade);
export const Library = criarIcone(biblioteca);
export const List = criarIcone(lista);
export const Loader2 = criarIcone(carregando);
export const LogIn = criarIcone(login);
export const Mail = criarIcone(email);
export const Monitor = criarIcone(monitor);
export const MoreHorizontal = criarIcone(maisHorizontal);
export const MoreVertical = criarIcone(maisVertical);
export const Newspaper = criarIcone(jornal);
export const Package = criarIcone(pacote);
export const Palette = criarIcone(paleta);
export const Pencil = criarIcone(lapis);
export const Play = criarIcone(tocar);
export const Plus = criarIcone(mais);
export const RefreshCw = criarIcone(recarregar);
export const Rocket = criarIcone(foguete);
export const Save = criarIcone(salvar);
export const Search = criarIcone(pesquisar);
export const Settings = criarIcone(configuracoes);
export const Shield = criarIcone(escudo);
export const ShieldCheck = criarIcone(escudo);
export const Sparkles = criarIcone(brilho);
export const Star = criarIcone(estrela);
export const Terminal = criarIcone(terminal);
export const Trash2 = criarIcone(lixeira);
export const Upload = criarIcone(upload);
export const User = criarIcone(pessoa);
export const Users = criarIcone(pessoas);
export const Wifi = criarIcone(wifi);
export const WifiOff = criarIcone(wifiOff);
export const X = criarIcone(fechar);
export const XCircle = criarIcone(fecharCaixa);
export const Avatar = criarIcone(avatar);
export const Filter = criarIcone(configuracoes);
