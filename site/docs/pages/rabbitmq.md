# RabbitMQ

Watch message rates, look into queues, exchanges and consumers, and publish or get messages.

## Add a broker

1. In *Connections*, click **New connection** and pick **RabbitMQ**.
2. Paste an `amqp://user:pass@host:5672/vhost` URL to fill the form, or enter the **Management host**, user,
   password and **Virtual host** yourself. Turn on **Use HTTPS** if the management API uses it.
3. Save, then right-click the connection → **Open**.

DevCat talks to RabbitMQ's management API, so the `rabbitmq_management` plugin must be enabled on the broker.

## What you can see

- **Overview** with live message-rate charts.
- **Queues**, **Exchanges** and their **Bindings**.
- **Connections**, **Channels** and **Consumers**.

## What you can do

- **Publish message** to an exchange, with a routing key and payload.
- **Get messages** from a queue to look at them.
- **Declare queue** and **Declare exchange** (classic or quorum queues), **Add binding**, **Add policy**.
- **Purge** a queue, and **Delete** queues and exchanges (DevCat asks first).
