import type { SVGProps } from "react";
import { Icon } from "@iconify/react";
import atividade from "@iconify-icons/pixelarticons/chart";
import alerta from "@iconify-icons/pixelarticons/warning-box";
import setaEsquerda from "@iconify-icons/pixelarticons/arrow-left";
import setaDireita from "@iconify-icons/pixelarticons/arrow-right";
import setasVertical from "@iconify-icons/pixelarticons/arrows-vertical";
import caixa from "@iconify-icons/pixelarticons/archive";
import calendario from "@iconify-icons/pixelarticons/calendar";
import checagem from "@iconify-icons/pixelarticons/check";
import chevronBaixo from "@iconify-icons/pixelarticons/chevron-down";
import chevronEsquerda from "@iconify-icons/pixelarticons/chevron-left";
import chevronDireita from "@iconify-icons/pixelarticons/chevron-right";
import chevronCima from "@iconify-icons/pixelarticons/chevron-up";
import relogio from "@iconify-icons/pixelarticons/clock";
import cafe from "@iconify-icons/pixelarticons/coffee";
import copia from "@iconify-icons/pixelarticons/copy";
import cpu from "@iconify-icons/pixelarticons/server";
import download from "@iconify-icons/pixelarticons/download";
import linkExterno from "@iconify-icons/pixelarticons/external-link";
import arquivoTexto from "@iconify-icons/pixelarticons/file-alt";
import pasta from "@iconify-icons/pixelarticons/folder";
import pastaMais from "@iconify-icons/pixelarticons/folder-plus";
import gamepad from "@iconify-icons/pixelarticons/gamepad";
import globo from "@iconify-icons/pixelarticons/globe";
import gripVertical from "@iconify-icons/pixelarticons/more-vertical";
import coracao from "@iconify-icons/pixelarticons/heart";
import casa from "@iconify-icons/pixelarticons/home";
import imagem from "@iconify-icons/pixelarticons/image";
import grade from "@iconify-icons/pixelarticons/grid";
import biblioteca from "@iconify-icons/pixelarticons/book";
import lista from "@iconify-icons/pixelarticons/list";
import carregando from "@iconify-icons/pixelarticons/loader";
import login from "@iconify-icons/pixelarticons/login";
import email from "@iconify-icons/pixelarticons/mail";
import monitor from "@iconify-icons/pixelarticons/monitor";
import maisHorizontal from "@iconify-icons/pixelarticons/more-horizontal";
import maisVertical from "@iconify-icons/pixelarticons/more-vertical";
import jornal from "@iconify-icons/pixelarticons/article";
import pacote from "@iconify-icons/pixelarticons/archive";
import paleta from "@iconify-icons/pixelarticons/colors-swatch";
import lapis from "@iconify-icons/pixelarticons/edit";
import tocar from "@iconify-icons/pixelarticons/play";
import mais from "@iconify-icons/pixelarticons/plus";
import recarregar from "@iconify-icons/pixelarticons/reload";
import foguete from "@iconify-icons/pixelarticons/zap";
import salvar from "@iconify-icons/pixelarticons/save";
import pesquisar from "@iconify-icons/pixelarticons/search";
import configuracoes from "@iconify-icons/pixelarticons/sliders";
import escudo from "@iconify-icons/pixelarticons/shield";
import brilho from "@iconify-icons/pixelarticons/moon-stars";
import estrela from "@iconify-icons/pixelarticons/moon-star";
import terminal from "@iconify-icons/pixelarticons/code";
import lixeira from "@iconify-icons/pixelarticons/trash";
import upload from "@iconify-icons/pixelarticons/upload";
import pessoa from "@iconify-icons/pixelarticons/user";
import pessoas from "@iconify-icons/pixelarticons/users";
import wifi from "@iconify-icons/pixelarticons/radio-signal";
import wifiOff from "@iconify-icons/pixelarticons/cellular-signal-off";
import fechar from "@iconify-icons/pixelarticons/close";
import fecharCaixa from "@iconify-icons/pixelarticons/close-box";
import avatar from "@iconify-icons/pixelarticons/avatar";

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
