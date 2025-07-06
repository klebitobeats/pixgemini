// api/mercado-pago-webhook.js
// Esta é uma função Serverless para Vercel que recebe notificações do Mercado Pago.

// Importa o Firebase Admin SDK
const admin = require('firebase-admin');

// Inicializa o Firebase Admin SDK (se ainda não estiver inicializado)
if (!admin.apps.length) {
    try {
        // ATENÇÃO: Substitua 'FIREBASE_SERVICE_ACCOUNT_KEY' pela sua variável de ambiente na Vercel
        // que contém a chave privada JSON da sua conta de serviço do Firebase.
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } catch (error) {
        console.error("Erro ao inicializar Firebase Admin SDK no webhook:", error);
        // Em um ambiente de produção, você pode querer um tratamento de erro mais robusto aqui.
    }
}
const db = admin.firestore();

module.exports = async (req, res) => {
    console.log("Webhook do Mercado Pago recebido!");
    console.log("Método:", req.method);
    console.log("Query Params:", req.query);
    console.log("Body:", req.body);

    // O Mercado Pago envia notificações via GET ou POST, dependendo da configuração.
    // O tipo de evento mais comum para pagamentos é 'payment'.
    // A notificação de pagamento geralmente vem com um ID de recurso (resource ID)
    // que você usa para consultar o status real do pagamento.

    // Para notificações de IPN (Instant Payment Notification) do Mercado Pago,
    // eles geralmente enviam um `id` na query string e um `topic`.
    const { id, topic } = req.query;

    if (!id || !topic) {
        console.warn("Webhook: ID ou Tópico ausente na requisição.");
        return res.status(400).send('ID ou Tópico ausente.');
    }

    if (topic === 'payment') {
        try {
            // Importe o SDK do Mercado Pago novamente para consultar o pagamento
            const mercadopago = require('mercadopago');
            mercadopago.configure({
                access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN // Use o mesmo Access Token
            });

            // Consulta o status do pagamento no Mercado Pago
            const paymentResponse = await mercadopago.payment.get(id);
            const payment = paymentResponse.body;

            console.log("Dados do pagamento do Mercado Pago:", payment);

            const orderId = payment.external_reference; // O ID do pedido que você passou
            const paymentStatus = payment.status; // Status do pagamento (e.g., 'approved', 'pending', 'rejected', 'cancelled')
            const userIdFromPayment = payment.metadata ? payment.metadata.userId : null; // Se você passou o userId no metadata

            let newOrderStatus = 'Pendente'; // Status padrão
            if (paymentStatus === 'approved') {
                newOrderStatus = 'Confirmado';
            } else if (paymentStatus === 'pending') {
                newOrderStatus = 'Aguardando Pagamento PIX'; // Pode manter este ou outro status de pendência
            } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
                newOrderStatus = 'Cancelado';
            }

            // ATENÇÃO: O APP_ID deve ser o mesmo do seu projeto Firebase principal (appv-ec0aa)
            const APP_ID = process.env.FIREBASE_PROJECT_ID || 'appv-ec0aa'; 

            // Atualiza o pedido na coleção pública
            const publicOrderDocRef = db.collection('artifacts').doc(APP_ID).collection('public').doc('data').collection('all_orders').doc(orderId);
            await publicOrderDocRef.update({
                status: newOrderStatus,
                paymentStatusDetail: payment.status_detail, // Detalhes adicionais do status
                mercadopagoId: payment.id, // ID do pagamento no Mercado Pago
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Pedido público ${orderId} atualizado para status: ${newOrderStatus}`);

            // Se o userId foi passado e está disponível, atualiza também o pedido do usuário
            // Isso é crucial para que o usuário veja o status correto em "Meus Pedidos"
            // Você deve garantir que o userId seja enviado do seu app principal para o Mercado Pago
            // (ex: via metadata na preferência de pagamento) e recuperado aqui.
            // Para este exemplo, vou assumir que o userId pode ser recuperado do documento do pedido público
            // se ele já foi salvo lá com o userId.
            // Ou, se o seu `create-pix-payment.js` envia o userId no metadata, recupere-o aqui.
            let userIdToUpdate = userIdFromPayment; // Tenta usar o userId do metadata do MP

            if (!userIdToUpdate) {
                // Se o userId não veio do metadata do MP, tenta buscá-lo do pedido público no Firestore
                const publicOrderSnapshot = await publicOrderDocRef.get();
                if (publicOrderSnapshot.exists && publicOrderSnapshot.data().userId) {
                    userIdToUpdate = publicOrderSnapshot.data().userId;
                    console.log(`UserId recuperado do pedido público: ${userIdToUpdate}`);
                } else {
                    console.warn(`Webhook: Não foi possível determinar o userId para o pedido ${orderId}.`);
                }
            }


            if (userIdToUpdate) {
                const userOrderDocRef = db.collection('artifacts').doc(APP_ID).collection('users').doc(userIdToUpdate).collection('orders').doc(orderId);
                await userOrderDocRef.update({
                    status: newOrderStatus,
                    paymentStatusDetail: payment.status_detail,
                    mercadopagoId: payment.id,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`Pedido do usuário ${userIdToUpdate} (${orderId}) atualizado para status: ${newOrderStatus}`);
            } else {
                console.warn(`Webhook: Não foi possível atualizar o pedido do usuário para ${orderId} porque o userId não foi encontrado.`);
            }

            res.status(200).send('OK');

        } catch (error) {
            console.error('Erro ao processar notificação do Mercado Pago:', error.response ? error.response.data : error.message);
            res.status(500).send('Erro interno do servidor.');
        }
    } else {
        // Outros tópicos de notificação (ex: merchant_order) podem ser ignorados ou tratados de forma diferente
        console.log(`Webhook: Tópico '${topic}' recebido, mas não processado.`);
        res.status(200).send('OK (Tópico não processado)');
    }
};
