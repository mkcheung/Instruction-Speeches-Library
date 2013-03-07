<?php
require_once("constants.php");
require_once("function.php");
require_once("DatabaseObject.php");
require_once("Session.php");
require_once("database.php");
require_once("user.php");
include_once("header.php");

$errors = array();
$required_fields = array('username','first_name','last_name','hashed_password');

    

if(isset($_POST['submit'])){
	
	print_r($_POST);

	foreach($required_fields as $required_field){
		if(!(isset($_POST[$required_field])) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$error[] = $required_field . ' is a required field';
		}
	}

	if(empty($errors)){

		$un = mysql_real_escape_string($_POST['username']);
		$pw = mysql_real_escape_string($_POST['hashed_password']);
		$fn = mysql_real_escape_string($_POST['first_name']);
		$ln = mysql_real_escape_string($_POST['last_name']);


		$newUser = User::register($un, $pw, $fn, $ln);

		if($newUser->save()){
			redirect_to("index.php");
		} else {
			die("Cannot register user. " . mysql_error());
		}
	}
	else {
		foreach($errors as $error){
			echo $error . '</br></br>' ;
		}
	}
}

?>

	<div id="registerErrorMessages"></div>

	<form action="register.php" method="post" id="userRegistrationForm">
		<legend>User Registration</legend>
		<input type="hidden" id="submit2" name="submit"/>
		First Name:<input type="text" id="first_name" name="first_name"/> </br>
		Last Name:<input type="text" id="last_name" name="last_name"/></br>
		User Name:<input type="text" id="username" name="username"/></br>
		Password:<input type="password" id="hashed_password" name="hashed_password"/></br>
		Password Confirmation:<input type="password" name="passwordConfirmation" id="passwordConfirmation"/></br>
		<input id="registerSubmit" type="submit" name="submit" class="btn btn-primary"/>
	</form>	
<?php
include_once("footer.php");
?>