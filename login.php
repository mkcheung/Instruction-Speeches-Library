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
if(isset($_POST['Login'])){

	foreach($required_fields as $required_field){
		if(!isset($_POST[$required_field]) || (empty($_POST[$required_field]) && is_numeric($_POST[$required_field]))){
			$errors[] = $_POST[$required_field] . ' is required.';
		}
	}
	print_r($_POST);
	if(empty($errors)){

		$un = mysql_real_escape_string($_POST['username']);
		$pw = mysql_real_escape_string($_POST['password']);

		$user = User::authenticate($un, $pw);

		$result = $SESS->login($user);

		if($result == true){
			redirect_to('index.php');
		} else {
			redirect_to('login.php');
		}
	} else {
		foreach($errors as $error){
			echo ('</br>$error</br>') ;
		}
	}
}

?>

