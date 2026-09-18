export default class Mensagens {
    public boasVindas = () => {
        console.log('\nBem-vindo a calculadora polimórfica\n')
    }

    public listarOpcoes = () => {
        console.log(`Aqui você pode:`)
        console.log(`Somar, Subtrair, Multiplicar, Dividir, Potenciar, Radiciar ou calcular as raízes com Bhaskara\n`)
    }

    public comoUsar = () => {
        console.log(`Para usar digite os números e a opção de cálculo separados por espaço como: "1.5 2.5 Somar"`)
        console.log(`O resultado será a soma dos números: 4`)
        console.log(`Para Radiciar informe o radicando e o índice: "27 3 Radiciar" resulta em 3`)
        console.log(`Para Bhaskara informe a, b e c de ax² + bx + c: "1 -3 2 Bhaskara" resulta nas raízes: 2,1`)
        console.log(`Para encerrar digite "Sair"\n`)
    }
}
