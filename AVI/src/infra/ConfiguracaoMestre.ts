import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import CriptografiaArquivo from "./CriptografiaArquivo";
import { escreverArquivoAtomico } from "./EscritaAtomica";
import { ErroIntegridade } from "../comum/erros";

const NOME_ARQUIVO = "greencode.conf";
const MARCADOR_PROVISIONAMENTO = ".provisionando";
const SENTINELA = "greencode-chave-ok";

type ConfiguracaoJSON = {
    formato: "greencode-config";
    versao: 1;
    chaveMestra: string;
    sentinela: string;
    administradorInicial: { usuario: string; papel: string; provisionadoEm: string };
    plataforma: string;
};

export default class ConfiguracaoMestre {
    public readonly chaveMestra: string;
    public readonly administradorInicial: string;
    public readonly provisionadoEm: Date;

    private constructor(chaveMestra: string, administradorInicial: string, provisionadoEm: Date) {
        this.chaveMestra = chaveMestra;
        this.administradorInicial = administradorInicial;
        this.provisionadoEm = provisionadoEm;
    }

    public static caminho(diretorio: string): string {
        return path.join(diretorio, NOME_ARQUIVO);
    }

    public static existe(diretorio: string): boolean {
        return fs.existsSync(ConfiguracaoMestre.caminho(diretorio));
    }

    public static caminhoMarcador(diretorio: string): string {
        return path.join(diretorio, MARCADOR_PROVISIONAMENTO);
    }

    public static salvar(diretorio: string, chaveMestra: string, administrador: string, agora: Date,
        criptografia: CriptografiaArquivo): ConfiguracaoMestre {
        const json: ConfiguracaoJSON = {
            formato: "greencode-config",
            versao: 1,
            chaveMestra,
            sentinela: criptografia.cifrar(SENTINELA, chaveMestra),
            administradorInicial: { usuario: administrador, papel: "ADMINISTRADOR", provisionadoEm: agora.toISOString() },
            plataforma: `${os.platform()} ${os.release()}`
        };
        escreverArquivoAtomico(ConfiguracaoMestre.caminho(diretorio), JSON.stringify(json, null, 2), { modo: 0o600 });
        return new ConfiguracaoMestre(chaveMestra, administrador, agora);
    }

    public static carregar(diretorio: string, criptografia: CriptografiaArquivo): ConfiguracaoMestre {
        let json: ConfiguracaoJSON;
        try {
            json = JSON.parse(fs.readFileSync(ConfiguracaoMestre.caminho(diretorio), "utf8")) as ConfiguracaoJSON;
        } catch (erro) {
            throw new ErroIntegridade(`Arquivo de configuração mestre ilegível: ${(erro as Error).message}`);
        }
        if (json.formato !== "greencode-config" || typeof json.chaveMestra !== "string" || !json.administradorInicial) {
            throw new ErroIntegridade("Arquivo de configuração mestre com formato inválido.");
        }
        if (criptografia.decifrar(json.sentinela, json.chaveMestra) !== SENTINELA) {
            throw new ErroIntegridade("A chave mestra não confere com a sentinela da configuração.");
        }
        return new ConfiguracaoMestre(json.chaveMestra, json.administradorInicial.usuario,
            new Date(json.administradorInicial.provisionadoEm));
    }
}
