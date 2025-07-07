// api/mercado-pago-webhook.js
// Esta é uma função Serverless para Vercel que recebe notificações do Mercado Pago.

// Importa o Firebase Admin SDK
const admin = require('firebase-admin');

// Inicializa o Firebase Admin SDK (se ainda não estiver inicializado)
if (!admin.apps.length) {
    try {
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

    const { id, topic } = req.query;

    if (!id || !topic) {
        console.warn("Webhook: ID ou Tópico ausente na requisição.");
        return res.status(400).send('ID ou Tópico ausente.');
    }

    // Define o APP_ID com base no projectId do seu Firebase (appfuncional-47d81)
    const APP_ID = 'appfuncional-47d81'; // Hardcoded conforme seu Firebase projectId

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
            // CRUCIAL: Obtém o userId do metadata que foi enviado na preferência de pagamento
            const userIdFromMetadata = payment.metadata ? payment.metadata.user_id : null; // Note: Mercado Pago pode converter 'userId' para 'user_id'

            let newOrderStatus = 'Pendente'; // Status padrão
            if (paymentStatus === 'approved') {
                newOrderStatus = 'Confirmado';
            } else if (paymentStatus === 'pending') {
                newOrderStatus = 'Aguardando Pagamento PIX';
            } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
                newOrderStatus = 'Cancelado';
            }

            let userIdToUpdate = userIdFromMetadata;

            // Se o userId não veio do metadata (verifique a caixa do campo, pode ser 'user_id' ou 'userId')
            // Tentamos uma busca no documento do pedido para garantir, mas o metadata é o mais confiável.
            if (!userIdToUpdate && orderId) {
                try {
                    // Tenta encontrar o pedido em alguma coleção de usuários para inferir o userId
                    // Esta é uma lógica de fallback e pode ser ineficiente para muitos pedidos.
                    // É preferível que o userId venha sempre no metadata.
                    const usersCollectionRef = db.collection('artifacts').doc(APP_ID).collection('users');
                    const usersSnapshot = await usersCollectionRef.get(); // Isso pode ser custoso!
                    for (const userDoc of usersSnapshot.docs) {
                        const userOrdersRef = usersCollectionRef.doc(userDoc.id).collection('orders');
                        const orderSnapshot = await userOrdersRef.doc(orderId).get();
                        if (orderSnapshot.exists) {
                            userIdToUpdate = userDoc.id;
                            console.log(`UserId recuperado por busca no Firestore: ${userIdToUpdate}`);
                            break;
                        }
                    }
                } catch (err) {
                    console.error("Erro ao tentar buscar userId no Firestore (fallback):", err);
                }
            }

            if (userIdToUpdate) {
                // Atualiza o pedido específico do usuário no Firestore
                const userOrderDocRef = db.collection('artifacts').doc(APP_ID).collection('users').doc(userIdToUpdate).collection('orders').doc(orderId);
                await userOrderDocRef.update({
                    status: newOrderStatus,
                    paymentStatusDetail: payment.status_detail,
                    mercadopagoId: payment.id,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`Pedido do usuário ${userIdToUpdate} (${orderId}) atualizado para status: ${newOrderStatus}`);
            } else {
                console.warn(`Webhook: Não foi possível atualizar o pedido para ${orderId} porque o userId não foi encontrado.`);
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
