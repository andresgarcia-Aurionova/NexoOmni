-- Keep every existing node type while enabling the appointment nodes
-- already supported by the flow builder and runner.
ALTER TABLE public.flow_nodes
  DROP CONSTRAINT flow_nodes_node_type_check;

ALTER TABLE public.flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end',
    'offer_slots',
    'book_appointment'
  ));
