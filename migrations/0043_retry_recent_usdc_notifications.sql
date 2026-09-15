-- Requeue recent USDC order emails that an older deployment permanently
-- skipped while the email provider or scheduled-origin configuration was
-- unavailable. Sent rows are intentionally untouched, so this cannot resend a
-- notification that the outbox already recorded as delivered.
UPDATE order_notifications
   SET state = 'pending',
       attempts = 0,
       lease_expires_at = NULL,
       last_error = 'Requeued after USDC notification delivery repair'
 WHERE state = 'skipped'
   AND kind IN ('customer-receipt', 'owner-notification')
   AND EXISTS (
     SELECT 1
       FROM orders
      WHERE orders.id = order_notifications.order_id
        AND orders.payment_method = 'usdc'
        AND orders.created_at >= datetime('now', '-30 days')
   );
