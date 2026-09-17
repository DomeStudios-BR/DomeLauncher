export interface FundoIcone {
    id: string;
    nome: string;
    topo: string;
    base: string;
}

export interface SimboloIcone {
    id: string;
    nome: string;
    arquivo: string;
    categoria: "loader" | "modificado" | "vanilla";
    excluirDaAleatorizacao?: boolean;
}

export const FUNDOS_ICONE: FundoIcone[] = [
    { id: "rosa", nome: "Rosa", topo: "#D62E63", base: "#F95C62" },
    { id: "laranja", nome: "Laranja", topo: "#FF8D29", base: "#FFB452" },
    { id: "amarelo", nome: "Amarelo", topo: "#FFC629", base: "#FFEE53" },
    { id: "lima", nome: "Lima", topo: "#6FDA1D", base: "#CBFF50" },
    { id: "verde", nome: "Verde", topo: "#0B9F21", base: "#4FD24B" },
    { id: "roxo", nome: "Roxo", topo: "#4739FF", base: "#6670FF" },
    { id: "azul", nome: "Azul", topo: "#227EFF", base: "#5EC1FF" },
    { id: "lavanda", nome: "Lavanda", topo: "#C056FD", base: "#B889FF" },
    { id: "pink", nome: "Pink", topo: "#F640C0", base: "#FF7BF1" },
    { id: "cinza-claro", nome: "Cinza claro", topo: "#AEAEAE", base: "#D9D9D9" },
    { id: "cinza", nome: "Cinza", topo: "#373C4C", base: "#4C4F58" },
    { id: "cinza-escuro", nome: "Cinza escuro", topo: "#1B1D29", base: "#252731" },
];

const caminho = (arquivo: string) => new URL(`../../assets/instance-icons/${arquivo}`, import.meta.url).href;

export const SIMBOLOS_ICONE: SimboloIcone[] = [
    { id: "fabric", nome: "Fabric", arquivo: caminho("fabric.png"), categoria: "loader", excluirDaAleatorizacao: true },
    { id: "forge", nome: "Forge", arquivo: caminho("forge.png"), categoria: "loader", excluirDaAleatorizacao: true },
    { id: "neoforge", nome: "NeoForge", arquivo: caminho("neoforge.png"), categoria: "loader", excluirDaAleatorizacao: true },
    { id: "quilt", nome: "Quilt", arquivo: caminho("quilt.png"), categoria: "loader", excluirDaAleatorizacao: true },
    { id: "poke-ball", nome: "Pokébola", arquivo: caminho("poke-ball.png"), categoria: "modificado" },
    { id: "orb", nome: "Orbe das Origens", arquivo: caminho("orb.png"), categoria: "modificado" },
    { id: "cooking-pot", nome: "Panela", arquivo: caminho("cooking-pot.png"), categoria: "modificado" },
    { id: "skillet", nome: "Frigideira", arquivo: caminho("skillet.png"), categoria: "modificado" },
    { id: "globe", nome: "Globo", arquivo: caminho("globe.png"), categoria: "modificado" },
    { id: "pancakes", nome: "Panquecas", arquivo: caminho("pancakes.png"), categoria: "modificado" },
    { id: "backpack", nome: "Mochila", arquivo: caminho("backpack.png"), categoria: "modificado" },
    { id: "couch", nome: "Sofá", arquivo: caminho("couch.png"), categoria: "modificado" },
    { id: "tiny-potato", nome: "Batata minúscula", arquivo: caminho("tiny-potato.png"), categoria: "modificado" },
    { id: "blue-shark", nome: "Tubarão azul", arquivo: caminho("blue-shark.png"), categoria: "modificado" },
    { id: "brown-bear", nome: "Urso marrom", arquivo: caminho("brown-bear.png"), categoria: "modificado" },
    { id: "moobloom", nome: "Moobloom", arquivo: caminho("moobloom.png"), categoria: "modificado" },
    { id: "wrench", nome: "Chave inglesa", arquivo: caminho("wrench.png"), categoria: "modificado" },
    { id: "cogwheel", nome: "Engrenagem", arquivo: caminho("cogwheel.png"), categoria: "modificado" },
    { id: "engine", nome: "Motor", arquivo: caminho("engine.png"), categoria: "modificado" },
    { id: "tire", nome: "Pneu", arquivo: caminho("tire.png"), categoria: "modificado" },
    { id: "oxygen-distributor", nome: "Distribuidor de oxigênio", arquivo: caminho("oxygen-distributor.png"), categoria: "modificado" },
    { id: "space-helmet", nome: "Capacete espacial", arquivo: caminho("space-helmet.png"), categoria: "modificado" },
    { id: "gizmo", nome: "Gizmo", arquivo: caminho("gizmo.png"), categoria: "modificado" },
    { id: "terminal", nome: "Terminal", arquivo: caminho("terminal.png"), categoria: "modificado" },
    { id: "wrench-rinth", nome: "Chave Modrinth", arquivo: caminho("wrench-rinth.png"), categoria: "modificado" },
    { id: "mr-pack", nome: "Pacote", arquivo: caminho("mr-pack.png"), categoria: "modificado" },
    { id: "grass-block", nome: "Bloco de grama", arquivo: caminho("grass-block.png"), categoria: "vanilla" },
    { id: "crafting-table", nome: "Bancada de trabalho", arquivo: caminho("crafting-table.png"), categoria: "vanilla" },
    { id: "furnace", nome: "Fornalha", arquivo: caminho("furnace.png"), categoria: "vanilla" },
    { id: "chest", nome: "Baú", arquivo: caminho("chest.png"), categoria: "vanilla" },
    { id: "bookshelf", nome: "Estante", arquivo: caminho("bookshelf.png"), categoria: "vanilla" },
    { id: "redstone-block", nome: "Bloco de redstone", arquivo: caminho("redstone-block.png"), categoria: "vanilla" },
    { id: "sticky-piston", nome: "Pistão pegajoso", arquivo: caminho("sticky-piston.png"), categoria: "vanilla" },
    { id: "slime-block", nome: "Bloco de slime", arquivo: caminho("slime-block.png"), categoria: "vanilla" },
    { id: "cake", nome: "Bolo", arquivo: caminho("cake.png"), categoria: "vanilla" },
    { id: "campfire", nome: "Fogueira", arquivo: caminho("campfire.png"), categoria: "vanilla" },
    { id: "pickaxe", nome: "Picareta", arquivo: caminho("pickaxe.png"), categoria: "vanilla" },
    { id: "sword", nome: "Espada", arquivo: caminho("sword.png"), categoria: "vanilla" },
    { id: "zombie", nome: "Zumbi", arquivo: caminho("zombie.png"), categoria: "vanilla" },
    { id: "creeper", nome: "Creeper", arquivo: caminho("creeper.png"), categoria: "vanilla" },
    { id: "skeleton", nome: "Esqueleto", arquivo: caminho("skeleton.png"), categoria: "vanilla" },
    { id: "ender-dragon", nome: "Dragão do End", arquivo: caminho("ender-dragon.png"), categoria: "vanilla" },
    { id: "ender-chest", nome: "Baú do End", arquivo: caminho("ender-chest.png"), categoria: "vanilla" },
    { id: "sculk-sensor", nome: "Sensor de sculk", arquivo: caminho("sculk-sensor.png"), categoria: "vanilla" },
    { id: "beacon", nome: "Sinalizador", arquivo: caminho("beacon.png"), categoria: "vanilla" },
    { id: "enchanting-table", nome: "Mesa de encantamentos", arquivo: caminho("enchanting-table.png"), categoria: "vanilla" },
    { id: "lantern", nome: "Lanterna", arquivo: caminho("lantern.png"), categoria: "vanilla" },
    { id: "tnt", nome: "TNT", arquivo: caminho("tnt.png"), categoria: "vanilla" },
    { id: "command-block", nome: "Bloco de comando", arquivo: caminho("command-block.png"), categoria: "vanilla" },
];

export const CONFIGURACOES_BLOQUEADAS = new Set([
    "roxo:globe", "azul:globe", "cinza:cogwheel", "cinza-escuro:cogwheel", "rosa:poke-ball",
    "lima:slime-block", "verde:slime-block", "rosa:redstone-block", "rosa:couch", "laranja:space-helmet",
    "rosa:tnt", "amarelo:moobloom", "verde:wrench-rinth", "lima:mr-pack", "cinza-claro:skillet",
    "cinza-claro:cooking-pot",
]);
