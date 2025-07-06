// api/create-pix-payment.js
// Esta é uma função Serverless da Vercel que será chamada pelo seu frontend.

// Importante: O Access Token do Mercado Pago deve ser uma variável de ambiente na Vercel!
// NUNCA coloque seu Access Token diretamente no código.
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

// URL da API do Mercado Pago para criar pagamentos
const MERCADO_PAGO_API_URL = 'https://api.mercadopago.com/v1/payments';

export default async function handler(req, res) {
    // Verifica se a requisição é do tipo POST (o frontend vai enviar dados por POST)
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    // Verifica se o Access Token está configurado
    if (!MERCADO_PAGO_ACCESS_TOKEN) {
        console.error('MERCADO_PAGO_ACCESS_TOKEN não configurado nas variáveis de ambiente da Vercel.');
        return res.status(500).json({ error: 'Erro de configuração do servidor.' });
    }

    // Pega os dados enviados pelo frontend (valor, id_pedido, etc.)
    const { valor, id_pedido, endereco, observacoes } = req.body;

    // Validação básica dos dados
    if (typeof valor !== 'number' || valor <= 0 || !id_pedido) {
        return res.status(400).json({ error: 'Valor ou ID do pedido inválido.' });
    }

    try {
        // Objeto com os dados do pagamento que serão enviados para o Mercado Pago
        // Consulte a documentação do Mercado Pago para mais opções:
        // https://www.mercadopago.com.br/developers/pt/guides/online-payments/checkout-api/integrate-payments
        const paymentData = {
            transaction_amount: parseFloat(valor), // Valor da transação
            description: `Pagamento do Pedido ${id_pedido}`, // Descrição do pagamento
            payment_method_id: 'pix', // Indica que é um pagamento Pix
            external_reference: id_pedido, // Seu ID de referência do pedido
            payer: {
                email: 'test_user@example.com', // Email do pagador (pode ser dinâmico)
                first_name: 'Nome', // Nome do pagador (pode ser dinâmico)
                last_name: 'Sobrenome', // Sobrenome do pagador (pode ser dinâmico)
                identification: {
                    type: 'CPF', // Tipo de documento
                    number: '11111111111' // Número do documento (pode ser dinâmico)
                },
                address: {
                    zip_code: endereco.cep || '00000000',
                    street_name: endereco.rua || 'Rua Teste',
                    street_number: endereco.numero || '123'
                }
            },
            // Informações adicionais que você pode querer passar
            metadata: {
                endereco_completo: endereco,
                observacoes_pedido: observacoes
            }
        };

        // Faz a requisição para a API do Mercado Pago
        const mpResponse = await fetch(MERCADO_PAGO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}` // Seu Access Token aqui
            },
            body: JSON.stringify(paymentData)
        });

        const mpData = await mpResponse.json();

        // Verifica se a requisição ao Mercado Pago foi bem-sucedida
        if (mpResponse.ok && mpData.point_of_interaction && mpData.point_of_interaction.transaction_data) {
            const qrCodeBase64 = mpData.point_of_interaction.transaction_data.qr_code_base64;
            const pixCopyPaste = mpData.point_of_interaction.transaction_data.qr_code; // O código copy-paste é o qr_code

            // Retorna o QR Code e o código Pix para o frontend
            res.status(200).json({
                qr_code_base64: qrCodeBase64,
                pix_copy_paste: pixCopyPaste,
                payment_id: mpData.id // ID do pagamento no Mercado Pago
            });
        } else {
            console.error('Erro ao criar pagamento Pix no Mercado Pago:', mpData);
            res.status(mpResponse.status).json({
                error: mpData.message || 'Erro ao criar pagamento Pix',
                details: mpData.cause
            });
        }

    } catch (error) {
        console.error('Erro na função create-pix-payment:', error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
}
