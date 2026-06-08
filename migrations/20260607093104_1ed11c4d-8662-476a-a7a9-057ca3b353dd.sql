
DROP POLICY IF EXISTS "Authenticated users own-topic realtime" ON realtime.messages;
DROP POLICY IF EXISTS "Admins all-topic realtime" ON realtime.messages;

CREATE POLICY "Authenticated realtime subscribe"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);
