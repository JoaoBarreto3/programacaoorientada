import * as readline from "readline";
import Mensagens from "./mensagens";
import Calculo from "./calculo";
import Soma from "./soma";
import Subtracao from "./subtracao";
import Multiplicacao from "./multiplicacao";
import Divisao from "./divisao";
import Potenciacao from "./potenciacao";
import Radiciacao from "./radiciacao";
import Bhaskara from "./bhaskara";

let mensagens = new Mensagens();

let iniciar = () => {
    let leitor = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    leitor.question(`Quais são seus números e a operação desejada?\n`, (valor) =>{
        let instrucoes = valor.split(' ')
        let numero1 = Number(instrucoes[0])
        let numero2 = Number(instrucoes[1])
        let numero3 = Number(instrucoes[2])
        let operacao = instrucoes[2]
        if(instrucoes.length == 1){
            operacao = instrucoes[0]
        }
        if(instrucoes.length == 4){
            operacao = instrucoes[3]
        }
        console.log(`Estas foram suas instruções: ${instrucoes}\n`)

        let calculo: Calculo

        switch(operacao){
            case "Somar":
                calculo = new Soma()
                console.log(`O resultado da operação é: ${calculo.calcular(numero1, numero2)}\n`)
                break;

            case "Subtrair":
                calculo = new Subtracao()
                console.log(`O resultado da operação é: ${calculo.calcular(numero1, numero2)}\n`)
                break;

            case "Multiplicar":
                calculo = new Multiplicacao()
                console.log(`O resultado da operação é: ${calculo.calcular(numero1, numero2)}\n`)
                break;

            case "Dividir":
                if(numero2 == 0){
                    console.log(`Erro: não é possível dividir por zero\n`)
                } else {
                    calculo = new Divisao()
                    console.log(`O resultado da operação é: ${calculo.calcular(numero1, numero2)}\n`)
                }
                break;

            case "Potenciar":
                calculo = new Potenciacao()
                console.log(`O resultado da operação é: ${calculo.calcular(numero1, numero2)}\n`)
                break;

            case "Radiciar":
                if(numero2 == 0){
                    console.log(`Erro: o índice da raiz não pode ser zero\n`)
                } else if(numero1 < 0){
                    console.log(`Erro: não existe raiz real de número negativo\n`)
                } else {
                    calculo = new Radiciacao()
                    console.log(`O resultado da operação é: ${calculo.calcular(numero1, numero2)}\n`)
                }
                break;

            case "Bhaskara":
                if(numero1 == 0){
                    console.log(`Erro: o valor de a não pode ser zero\n`)
                } else if(numero2 ** 2 < 4 * numero1 * numero3){
                    console.log(`Erro: delta negativo, não existem raízes reais\n`)
                } else {
                    calculo = new Bhaskara()
                    console.log(`As raízes da equação são: ${calculo.calcular(numero1, numero2, numero3)}\n`)
                }
                break;

            case "Sair":
                console.log(`Calculadora encerrada\n`)
                leitor.close()
                return

            case "Jesus":
                console.log(`Jesus Cristo é o Senhor!`)
                leitor.close()
                return

            default:
                console.log(`Operação inválida\n`)
                break;
        }

        leitor.close()
        iniciar()
    })
}

mensagens.boasVindas()
mensagens.listarOpcoes()
mensagens.comoUsar()
iniciar()
