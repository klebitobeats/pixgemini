// api/mercado-pago-webhook.js
// Esta é uma função Serverless da Vercel que será chamada pelo Mercado Pago.

const MERCADO_PAGO_ACCESS_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN;

export default async function handler(req, res) {
    // O Mercado Pago envia notificações via POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    // Pega o corpo da requisição enviada pelo Mercado Pago
    const notification = req.body;

    console.log('Notificação do Mercado Pago recebida:', notification);

    // O Mercado Pago envia diferentes tipos de notificações.
    // Estamos interessados nas notificações de 'payment' (pagamento).
    if (notification.topic === 'payment') {
        const paymentId = notification.id; // O ID do pagamento no Mercado Pago

        if (!paymentId) {
            console.warn('Notificação de pagamento sem ID. Ignorando.');
            return res.status(400).json({ message: 'ID do pagamento ausente.' });
        }

        try {
            // Consulta a API do Mercado Pago para obter os detalhes completos do pagamento
            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`
                }
            });

            const paymentDetails = await mpResponse.json();

            if (mpResponse.ok) {
                const paymentStatus = paymentDetails.status;
                const externalReference = paymentDetails.external_reference; // Nosso ID de pedido

                console.log(`Detalhes do Pagamento ${paymentId}: Status: ${paymentStatus}, Pedido: ${externalReference}`);

                // *** AQUI É ONDE A MÁGICA ACONTECE! ***
                // Se o pagamento foi aprovado, você pode:
                // 1. Atualizar o status do pedido no seu banco de dados (se você tiver um).
                // 2. Enviar um e-mail de confirmação para o cliente.
                // 3. Notificar seu sistema de estoque para liberar o produto.
                // 4. Em um cenário mais avançado, você poderia usar WebSockets para notificar o frontend do cliente.

                if (paymentStatus === 'approved') {
                    console.log(`✅ Pagamento APROVADO para o Pedido ${externalReference}!`);
                    // Exemplo: Chamar uma API no seu app principal para atualizar o status do pedido
                    // fetch('https://meu-webapp-principal.vercel.app/api/update-order-status', {
                    //     method: 'POST',
                    //     headers: { 'Content-Type': 'application/json' },
                    //     body: JSON.stringify({ id_pedido: externalReference, status: 'pago' })
                    // });
                } else if (paymentStatus === 'pending') {
                    console.log(`⏳ Pagamento PENDENTE para o Pedido ${externalReference}.`);
                } else if (paymentStatus === 'rejected') {
                    console.log(`❌ Pagamento REJEITADO para o Pedido ${externalReference}.`);
                }
                // Outros status: https://www.mercadopago.com.br/developers/pt/guides/online-payments/checkout-api/handling-responses

                // Sempre retorne um status 200 OK para o Mercado Pago,
                // para que ele saiba que você recebeu a notificação com sucesso.
                res.status(200).json({ message: 'Notificação de pagamento processada com sucesso.' });

            } else {
                console.error(`Erro ao buscar detalhes do pagamento ${paymentId}:`, paymentDetails);
                res.status(mpResponse.status).json({ error: 'Erro ao buscar detalhes do pagamento.' });
            }

        } catch (error) {
            console.error('Erro ao processar webhook do Mercado Pago:', error);
            res.status(500).json({ error: 'Erro interno do servidor ao processar notificação.' });
        }
    } else {
        // Se for outro tipo de notificação que não nos interessa, apenas loga e retorna OK
        console.log(`Notificação de tópico '${notification.topic}' recebida. Ignorando.`);
        res.status(200).json({ message: `Notificação de tópico '${notification.topic}' recebida.` });
    }
}
