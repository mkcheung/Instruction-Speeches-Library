<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("function.php");
require_once("Session.php");
include_once("header.php");
include_once("footer.php");

$required_fields = array('username','password');
$errors = array();

if($_GET['kickoutStatus'] == 1)
{
		?>
		<script>
			$('div[class="alert alert-error"]').remove();
			$('div[class="alert alert-success"]').remove();
			$('#registerErrorMessages').append('<div class="alert alert-error"><?=$_GET["flashMessage"]?></div>');
			$('#registerErrorMessages').removeAttr('style');
			$('#registerErrorMessages').fadeOut(2000);
		</script>
		<?php
}

if(isset($_POST['login'])){

	$un = mysql_real_escape_string($_POST['username']);
	$pw = mysql_real_escape_string($_POST['password']);

	$user = User::authenticate($un, $pw);

	$result = $SESS->login($user);

	if($result == true){
		redirect_to('index.php');
	} else {
		?>
			<script>
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				errorDisplay = '<div class="alert alert-error">Incorrect username or password.</div>';
				$('#registerErrorMessages').append(errorDisplay);
				$("#registerErrorMessages").removeAttr('style');
				$('#registerErrorMessages').fadeOut(2000);
			</script>
		<?php
	}

	// foreach($required_fields as $required_field){
	// 	if(!isset($_POST[$required_field]) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
	// 		$errors[] = $_POST[$required_field] . ' is required.';
	// 	}
	// }

	// if(empty($errors)){

	// 	$un = mysql_real_escape_string($_POST['username']);
	// 	$pw = mysql_real_escape_string($_POST['password']);

	// 	$user = User::authenticate($un, $pw);

	// 	$result = $SESS->login($user);

	// 	if($result == true){
	// 		redirect_to('index.php');
	// 	} else {
	// 		redirect_to('login.php');
	// 	}
	// } else {
	// 	foreach($errors as $error){
	// 		echo ('</br>$error</br>') ;
	// 	}
	// }
}


?>				    
	<script>
		// $('#loginForm').submit(function(e){
			$('#loginForm').on("click","#loginSubmit", function(e){
			e.preventDefault();
			var uname = $('#loginForm #username').val();
			var pword = $('#loginForm #password').val();
			var valid = '';

			if(uname.length == 0){
				valid += '<p>Please enter a username.</p>';
			}
			if(pword.length == 0){
				valid += '<p>Please enter password.</p>';
			}

			if (valid.length>0){
				$('div[class="alert alert-error"]').remove();
				$('div[class="alert alert-success"]').remove();
				$('#registerErrorMessages').append('<div class="alert alert-error">' + valid + '</div>');
				$("#registerErrorMessages").removeAttr('style');
				$('#registerErrorMessages').fadeOut(2000);
			} else {
				$('#loginForm').submit();
			}
		});
	</script>
<?php



?>

